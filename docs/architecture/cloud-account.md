# Cloud account contract

The native client signs in to one New API user and uses that user's existing
wallet and billing services. BYOK provider configuration remains independently
usable. The public local contract is defined in
[`cloud_account.rs`](../../core/crates/openh3-api-types/src/cloud_account.rs).
It contains DTOs only; this document does not assert that the routes below are
already deployed. Contract fixtures are synthetic local serialization tests,
not recordings of a gateway.

## Trust boundary

The desktop renderer uses the narrow `electronAPI.cloudAccount` operation API;
Electron main calls `/api/cloud-account/*` on its owned Core. WebUI uses the
existing same-origin HTTP bridge. Every route, including capabilities,
registration, recovery and login, requires
the authenticated local application identity. Cloud login establishes a remote
account association; it does not replace local authentication. Handlers derive
the local owner from `CurrentUser`, never a body/query `user_id`. Account IDs in
responses identify the remote account and cannot select a local owner.

All mutations require CSRF protection. The generic middleware needs deliberate
integration: [`auth_middleware`](../../core/crates/openh3-auth/src/middleware.rs)
injects a default user in local mode and accepts conversation helper credentials
in other modes;
[`csrf_middleware`](../../core/crates/openh3-auth/src/csrf.rs) exempts the helper
header channel. The current
[`app router`](../../core/crates/openh3-app/src/router/routes.rs) also skips its
global CSRF layer in local mode. Cloud account routes must enforce the trusted
desktop session boundary and CSRF in local mode as well, and must reject
conversation helper credentials. Merely attaching the existing generic guards
does not prove these requirements. Route tests must exercise unauthenticated,
missing/invalid CSRF, helper-channel and cross-user cases.

Success payloads use the existing `ApiResponse<T>`; failures use `ErrorResponse`.
Empty successful operations use `ApiResponse<()>`. Public DTOs reject unknown
fields. Password and verification-code requests do not implement `Debug` or
`Serialize`; they must not be echoed, persisted or logged. Public responses
contain neither access/refresh/inference credentials nor dashboard roles,
permissions or administrator capabilities. Never proxy a raw upstream response
or error body to the renderer. The configured gateway origin is trusted Core
configuration, not a request field.

## Local routes and payloads

All paths in this table have the `/api/cloud-account` prefix. Every timestamp is
Unix seconds. Types below have the `CloudAccount` prefix in Rust.

| Method and suffix               | Request                        | Success data                    |
| ------------------------------- | ------------------------------ | ------------------------------- |
| `GET /capabilities`             | None                           | `CapabilitiesResponse`          |
| `POST /email-code`              | `EmailCodeRequest`             | Empty                           |
| `POST /register`                | `RegisterRequest`              | `RegisterResponse`              |
| `POST /login`                   | `LoginRequest`                 | `SessionResponse`               |
| `POST /auth/verify`             | `VerifyRequest`                | `VerifyResponse`                |
| `POST /password/reset`          | `PasswordResetRequest`         | `PasswordResetResponse`         |
| `POST /password/reset/complete` | `PasswordResetCompleteRequest` | `PasswordResetCompleteResponse` |
| `GET /session`                  | None                           | `SessionResponse`               |
| `GET /me`                       | None                           | `SessionResponse`               |
| `POST /logout`                  | Empty JSON object              | `LogoutResponse`                |
| `GET /wallet`                   | None                           | `WalletResponse`                |
| `GET /models`                   | None                           | `ModelsResponse`                |
| `GET /usage`                    | `PageQuery`                    | `UsageResponse`                 |
| `GET /devices`                  | None                           | `DevicesResponse`               |
| `POST /devices/revoke`          | `RevokeDeviceRequest`          | `RevokeDeviceResponse`          |
| `GET /topup/options`            | None                           | `TopupOptionsResponse`          |
| `POST /topup/orders`            | `CreateTopupRequest`           | `TopupOrder`                    |
| `GET /topup/orders`             | `PageQuery`                    | `TopupOrdersResponse`           |
| `GET /topup/orders/{order_id}`  | Path order ID                  | `TopupOrder`                    |

`SessionResponse.state` is one of:

- `disabled`: the product feature is disabled.
- `unconfigured`: no usable trusted gateway configuration is available.
- `disconnected`: no connected account or pending verification exists.
- `verification_required`: password verification succeeded but a supported
  second factor is required. The response includes a local `challenge_id`,
  expiration and supported `totp`/`backup_code` methods.
- `connected`: Core has established the account association and activated its
  device grant; `account` contains only ID, username, display name and nullable
  email.
- `reauth_required`: the prior association cannot authenticate, for example
  after expiry, revocation or a security-version change.

Transport failure is a sanitized error, not evidence of logout or a zero
balance. Core binds each local challenge handle to the local owner, gateway,
remote flow and login attempt. Another user cannot complete it. A new attempt
invalidates the old local handle; expired or consumed challenges cannot be
replayed. The gateway's `flow_token` stays private to Core.

`RegisterResponse` is only `{"status":"registered"}`. It creates no local
connection and requires a separate login. Registration always accepts an email
input; `verification_code` is conditional on the advertised policy. The server
must not bind an unverified address merely because it appeared in that input.
Email-code purposes are `registration` and `password_reset`. Successful recovery
does not sign in, return a generated password or reveal whether the email exists.

Recovery has two stages. `/password/reset` accepts only email and email code,
returning `ready {challenge_id, expires_at}` or `verification_required`. An enrolled
MFA factor must be verified before readiness. `/password/reset/complete` accepts
the local ready handle and `new_password`; it consumes the private reset proof
and changes the password atomically. No password is stored while MFA is pending.
The ready handle is not the gateway proof token and is bound to the local owner.

Device revocation starts with `device_id` and returns `revoked` or
`verification_required`; enrolled MFA is required, or current-password
reauthentication when no MFA is enrolled. A `revoked` result is valid only after
the server has consumed an appropriate bound authorization, or for an already
revoked owned device. Verification descriptors carry purpose `login`,
`password_reset` or `device_revocation`. `VerifyRequest` is discriminated by
`method`: `totp` and `backup_code` take `code`, while `password` takes `password`.
The server checks the requested method against the bound ceremony's policy.
`VerifyResponse.result` is `login {session}`,
`password_reset_ready {challenge_id, expires_at}` or `device_revoked`; a successful revoke verification
completes the exact device action stored in the challenge. The caller cannot
switch the challenge purpose or target.

Capabilities describe registration, email verification, password login and
password recovery, plus local availability. They never describe administrative
permissions. `anti_bot: "unsupported_required"` means the deployment requires a
ceremony that this native flow cannot perform. Affected actions must fail closed
with a useful native error; the client must not silently bypass Turnstile. When
availability is `disabled` or `unconfigured`, action flags are false. Password
encryption policy is handled privately by Core rather than exposed to the UI.

`PageQuery` uses `page` and `page_size`, defaulting to 1 and 20. Routes must reject
`page < 1` and `page_size` outside 1–100 before remote I/O; Rust unsigned fields
alone do not enforce these bounds. Responses use `page`, `page_size`, `total`
and `items`. There are no invented opaque cursors. Order IDs and device IDs are
opaque remote identifiers; every lookup/revocation must check authenticated
account ownership, including a request to revoke the current device.

## Authoritative billing display

`Money` uses a decimal `amount` string and ISO currency; `Quota` uses an `amount`
string and explicit unit, such as `new_api_quota` or `tokens`. There are no
floating-point monetary fields in this contract. The adapter must preserve
server precision and validate decimal shape, sign and bounds; string types alone
do not implement financial validation. The renderer never converts quota to
currency, applies group ratios, evaluates pricing expressions, subtracts a
subscription balance or predicts a final charge.

`WalletResponse.as_of` is the gateway snapshot's observed Unix time. Core must
retain that time when serving a cached value, so the UI can identify stale data.
`WalletResponse` distinguishes three sources:

- `wallet_balance`: `available {amount}` or `unavailable`, sourced from the user
  wallet. A missing value is never displayed as zero.
- `subscriptions`: `available {items}` or `unavailable`. An available empty list
  means no applicable subscriptions. Each item has its own server-calculated
  remaining allowance and expiry; `unlimited` is explicit.
- `device_limit`: the current device's normal inference token allowance,
  `limited {amount}`, `unlimited` or `unavailable`. An unlimited device token does
  not imply unlimited wallet funds. This field is not a maximum device count.

`ModelPrice` is `rates`, `expression`, `description` or `unavailable`. Rates carry
a server-provided monetary price and per-quantity unit. Expression text and its
server-provided description are display-only. Request-dependent, plugin and
tiered pricing must not be flattened into a fictitious fixed input/output pair.
The description must retain applicable group/context caveats. Model availability
is filtered for the authenticated account by the server.

The usage endpoint exposes settled consumption records only. Pending charges
are unavailable unless a future gateway source supplies reliable pending state;
the adapter must never fabricate pending records. Usage records contain the
settled server charge and only quantities actually present in the record.
No raw log `other` payload, provider secrets or admin-only
metadata crosses the local API.

Topup options contain an opaque server option ID, payment method, payable money
and credited quota. Creation accepts only that option ID and an idempotency key;
the server resolves and validates the option again. Stale prices must be rejected
or presented for fresh confirmation, never silently replaced after acceptance.
The idempotency scope is the account plus key and must reject a different option
under an already-used key. The server returns the authoritative order amounts
and an optional checkout: `url {url}` or `qr {payload}`, only when the configured
provider supplies it. QR payloads are validated bounded data, never executable
markup; they are rendered as a QR code without interpreting them as instructions.
A checkout URL is an external payment
handoff; browser return does not prove payment. Only the existing provider
callback/settlement path can mark an order `success`. Querying an order cannot
credit a wallet. Status values preserve upstream `pending`, `success`, `failed`
and `expired`.

## Existing New API evidence

The inspected upstream source is the
[QuantumNous/new-api v1.0.0-rc.49 tag](https://github.com/QuantumNous/new-api/tree/v1.0.0-rc.49).
The extracted source archive was committed locally as
`1f3d563b4a4da8e9cdf9be7b1acb8326fda68add`; that identifier is a local archive
baseline, not an upstream GitHub commit.
Paths below are relative to that checkout. They are source evidence, not claims
that the proposed native endpoints already exist.

| Existing source                                                                          | Verified behavior and reuse boundary                                                                                                                                                                                                                                                                                         |
| ---------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `router/api-router.go`, `controller/user.go`                                             | Dashboard register/login/self routes exist. `Register` enforces policy and inserts a common user; it may create a permanent default inference token when `GenerateDefaultToken` is enabled. Its result is not a login. Do not call this controller unchanged for native registration.                                        |
| `controller/user.go::Login`, `GetPasswordEncryptionKey`                                  | When password encryption is enabled, login requires `password_encrypted` and `encryption_key_id`; plaintext alone is rejected. Core must honor the deployment policy.                                                                                                                                                        |
| `service/auth_session.go`, `service/auth_token.go`, `model/user_session.go`              | `CreateLoginSessionAtAuthVersion` and `RefreshLoginSession` use existing session/security versions and refresh rotation. Access TTL is 15 minutes, session TTL 30 days, replay window 30 seconds. The existing JWT audience is `new-api-dashboard`; a desktop audience is additional work.                                   |
| `service/login_verification.go`, `service/security_verification.go::VerifyTwoFactorCode` | `StartLoginVerification` creates an expiring flow. `VerifyLoginCode` accepts TOTP or backup codes through shared verification; completion consumes the flow and creates a session atomically. Desktop audience/grant binding must preserve these checks.                                                                     |
| `model/auth_flow.go`                                                                     | `AuthFlow` stores purpose, identity binding, expiry and consumed state. `ConsumeAuthFlowWithAction` consumes the flow and runs the action in one transaction, rolling back on failure. Reuse this primitive for native email ceremonies.                                                                                     |
| `common/verification.go`, `controller/misc.go::ResetPassword`                            | Old email-code storage keeps plaintext codes in a process-local map; verification does not consume them. Old reset generates and returns a random password, then deletes the code separately. This is not the proposed native recovery protocol.                                                                             |
| `model/user.go::InsertWithTx`, `ResetUserPasswordByEmail`                                | Shared user insertion initializes the existing wallet. Reset hashes the password and increments auth version in a transaction, then publishes auth cache and revokes sessions. Native reset must combine flow consumption with the shared atomic security helpers; nesting the old handler does not establish that property. |
| `controller/user.go::buildSelfUserData`, `model/token.go`, `model/subscription.go`       | Dashboard self data includes wallet quota plus role/permissions; token remaining quota and unlimited flag are separate; subscription total/used/reset/expiry fields are separate again. Public native projection must select safe fields.                                                                                    |
| `model/pricing.go`                                                                       | Pricing includes ratios, fixed prices, billing expressions and plugin variants. It is not always a pair of token prices.                                                                                                                                                                                                     |
| `controller/log.go::GetUserLogs`, `common/page_info.go`                                  | User log scope comes from authenticated context. Existing page query spelling is `p` with `page_size` (legacy aliases exist); responses expose `page`, `page_size`, `total`, `items`, and page size is capped at 100. The native adapter translates names and validates a lower bound.                                       |
| `controller/topup.go`, `model/topup.go`, `common/constants.go`                           | Existing topup options, payment creation, account-scoped order listing, quota capacity checks and provider settlement are the source of topup behavior and status. Reuse these services and ledger.                                                                                                                          |

Billing adapter work must follow the upstream `.agents/rules/billing.md`, read
for this contract: use existing quota conversion and wallet capacity helpers,
bound untrusted amounts, preserve overflow protections and retain settlement
authority. `pkg/billingexpr/expr.md` describes expression semantics; this change
only transports their display text and does not change expression evaluation.

## Private gateway lifecycle

The Core account lifecycle now lives under `openh3-system::provider::cloud_account`.
AppServices constructs it and the guarded local HTTP transport. Construction takes a
trusted, immutable HTTPS origin (explicit loopback opt-in for development), a
persistent storage encryption key, and `ICloudAccountRepository`. Migration 047
stores encrypted grants bound to local owner, issuer, remote subject, device and
a fresh managed provider. Provider creation and pending persistence are atomic;
activation and rotation commit before connected state or inference credentials
are returned. Generation tombstones fence remote replies after logout.

First-external-user data adoption preserves both the cloud identity binding and
its managed provider under the original local owner. It still adopts BYOK rows
and conversations. An adopted conversation's old cloud provider cannot resolve
under the new owner; that owner must explicitly establish a new cloud binding.
The original owner retains its grant and ability to revoke the remote device.

An active or pending binding must be explicitly logged out before another login.
Logout disables the provider and clears credentials before remote revocation;
`remote_revocation` is `confirmed`, `unconfirmed`, or `not_needed`. Unconfirmed
means no confirmation was received; there is no background revocation queue.
The UI must display this outcome when switching accounts. The old provider ID
remains disabled, and the next connection creates a new ID. Password-reset
completion returns `session_cleanup_pending`; true still means the password was
committed and its proof consumed. It must not invite replaying that proof.

The current adapter follows `controller/native_account.go`,
`controller/native_account_dto.go` and `common/password_crypto.go` in the pinned
gateway worktree at `27fc5147c0fac86381f1e2678492e6008889f56e`. Email delivery uses
`{email, request_id}`; recovery ownership is proven through `/auth/verify`;
reset-ready uses a private `flow_token`, not a `reset_proof` field. Complete-reset
returns `{state: "password_reset", session_cleanup_pending}`. Password encryption
uses the advertised v2 RSA-OAEP/SHA256 + AES-256-GCM envelope with the gateway's
key ID, never an automatic plaintext fallback.

## Verification scope

`cloud_account_contract.rs` fixes public JSON shapes, string monetary quantities,
unknown-field rejection, state distinctions and the separation between
registration and login. Compile-fail documentation tests prevent password DTOs
from gaining `Debug` unnoticed. These checks do not verify authorization, CSRF,
remote audience isolation, expiry/replay, per-device inference revocation,
payment callbacks, decimal validation or real gateway compatibility. Those need
route/service tests and pinned gateway integration tests as implementations land.

The lifecycle implementation records sanitized lifecycle outcomes, never passwords,
codes, flow/access/refresh/inference tokens, raw remote responses or checkout
URLs. Audit financial transitions through existing gateway billing observability.

## Implemented account transport

Core exposes only capabilities, session, me, devices, email-code, register, login,
auth/verify, password/reset, password/reset/complete, logout and devices/revoke
under /api/cloud-account. Billing, wallet, model and topup paths are not installed.
Requests use the public DTOs and ApiResponse/ErrorResponse; JSON is capped at
16 KiB, unknown fields and queries are rejected, and every response is no-store.
Local-auth, cloud-auth, verification, policy, rate-limit and transport failures have
distinct fixed codes. Rate-limit responses retain Retry-After. Neither transport
replays cloud operations after a 401. Polling reads do not consume the per-user
sensitive-action budget. Logout also bypasses that budget so failed attempts
cannot prevent local disconnect.

Configuration is read once at process bootstrap and can be injected as typed
CloudAccountTransportConfig in tests. OPENH3_CLOUD_ACCOUNT_ENABLED=1 opts in;
the default is disabled and no endpoint. OPENH3_CLOUD_ACCOUNT_ENDPOINT is a
trusted operator-controlled HTTPS origin; the renderer cannot select it.
OPENH3_CLOUD_ACCOUNT_ALLOW_LOOPBACK_HTTP=1 permits only explicit loopback HTTP
for development. OPENH3_CLOUD_ACCOUNT_TRUSTED_ORIGINS is a comma-separated list
of browser origins. Host and forwarded headers do not establish trust.

Electron main generates a fresh in-memory capability per launch and injects it
only into its owned Core child's environment. Core consumes and removes it while
still single-threaded, before runtime initialization or login-shell probing, so
even plain subprocesses cannot inherit it. It remains only in typed application
state. Main bootstraps CSRF through local /health without the capability or any
cloud I/O, and uses bounded, redirect-free fetches. The preload cloudAccount operation accepts
only the native operation union, never headers, paths, URLs or owner IDs. Only
the owned window's top-level frame on the packaged renderer document or the
configured unpackaged development URL can invoke it (hash navigation is allowed).
The synchronous port API is unchanged. Desktop cloud IPC currently supports Local
identity mode only; nonlocal capability-only requests fail LOCAL_AUTH_REQUIRED.
The renderer must use this IPC in desktop mode and must never fall back to direct
unauthenticated HTTP when it is unavailable.

WebUI requests, including requests forwarded into a Local Core, require a real
UserSession plus a configured trusted Origin (or same-origin Referer on GET) and
CSRF for mutations. The static server marker forces session authentication and
cannot be combined with the desktop capability. All current and legacy helper
credential headers are rejected independently. Cloud routes run outside the
global permissive CORS path and retain the existing update-admission gate; other
identity and BYOK routes retain their behavior.

Access logs use generated request IDs and literal route labels, with no query
keys or values. Malformed input and unknown field errors use fixed text. The
HTTP bridge suppresses cloud bodies and sanitizes errors before retaining them.
The capability is filtered from inherited agent environments and spawn builders.
Tests use in-memory SQLite, local gateway fixtures and synthetic credentials;
no real email, inference, payment or account credentials are used.

## Managed provider transport seam

`core/vendor/aion-providers` copies the `aion-providers` crate from
[`iOfficeAI/aionrs`](https://github.com/iOfficeAI/aionrs/tree/8e61a90329fa9f67c4fdf7e97fe02c24dba33f75/crates/aion-providers),
tag `v0.2.11`, commit `8e61a90329fa9f67c4fdf7e97fe02c24dba33f75`.
The original Apache-2.0 license, source layout, projectors, parsers and upstream
tests are retained. The Cargo patch follows the existing `aion-mcp` convention;
the provider crate is also a workspace member so its original dev tests run.
Its standalone manifest derives dependency versions/features from that pinned
workspace; `workspace-hack` remains the pinned Git build helper. The additional
test dependencies use the upstream lock versions. Existing locked dependencies
are not upgraded.

The patch adds only an opt-in `OpenAIProvider::new_managed` constructor and the
associated transport, stream, error and diagnostics policy. `OpenAIProvider::new`
retains BYOK defaults. The caller supplies a trusted validated issuer origin,
private inference credential and explicit catalog `OpenAiApiMode`. The constructor
fixes the endpoint to `/v1/chat/completions` or `/v1/responses`, overriding a custom
compatibility path without guessing from model names. Credentials are held in
private types without Debug/Serialize and the managed authorization HeaderValue
is marked sensitive.

Verified in `transport.rs` and `stream_runner.rs`: managed clients disable
redirects, reqwest retries, initial connection/5xx retries and stream resends.
They use a 15-second connection timeout and a 120-second per-read idle timeout,
with no total generation deadline. Non-success response bodies are dropped
without reading or allocating their contents. The existing bounded 64 KiB
success-JSON inspector is retained. Error values retain a status where available
and fixed categories, removing raw upstream body, URL and parser error text
before delivery, including fields exposed through Debug. Direct parser Error
events receive the same treatment.

Verified in `composed.rs` and `stream_process.rs`: managed projection and parser
diagnostics that could contain upstream tool IDs are suppressed; fixed projection
counters and stream shape summaries remain. Managed summaries do not retain
upstream request IDs, and Responses frame event names are omitted. The stream
runner selects receiver closure while processing a managed response, so dropping
the receiver closes a silent HTTP stream without waiting for another SSE chunk
or idle timeout. Dropping the initial request future also cancels pending I/O.
Chat finish-reason plus clean-EOF completion and Responses terminal/tool/usage
semantics remain those of the pinned parsers.

`tests/managed_openai_test.rs` uses synthetic loopback HTTP/SSE fixtures derived
from the pinned upstream tests. It checks actual received request counts,
redirect target isolation, server-observed socket closure, text/tools/usage and
sentinel-free DEBUG logs/errors alongside the original BYOK regression suite.
These checks establish client/provider behavior only; they do not establish
whether a gateway or supplier retries a request.

This seam is not wired into the application and does not enable official
inference. Task 5b still owns the per-request account resolver, lifetime
cancellation on account changes, AppServices/factory/manager integration and
actual AgentBootstrap request-count tests. Its wrapper must reject missing
terminal events and empty, whitespace-only or reasoning-only finals before
the engine's implicit retries. Catalog/price/billing verification and UI/E2E
integration remain separate work.
