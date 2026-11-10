# Cloud account contract

The native client signs in to one New API user and uses that user's existing
wallet and billing services. BYOK provider configuration remains independently
usable. The public local contract is defined in
[`cloud_account.rs`](../../core/crates/openh3-api-types/src/cloud_account.rs).
It contains DTOs only; this document does not assert that the routes below are
already deployed. Contract fixtures are synthetic local serialization tests,
not recordings of a gateway.

## Trust boundary

The renderer calls `/api/cloud-account/*` through the existing local API bridge.
Every route, including capabilities, registration, recovery and login, requires
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

| Method and suffix               | Request                        | Success data            |
| ------------------------------- | ------------------------------ | ----------------------- |
| `GET /capabilities`             | None                           | `CapabilitiesResponse`  |
| `POST /email-code`              | `EmailCodeRequest`             | Empty                   |
| `POST /register`                | `RegisterRequest`              | `RegisterResponse`      |
| `POST /login`                   | `LoginRequest`                 | `SessionResponse`       |
| `POST /auth/verify`             | `VerifyRequest`                | `VerifyResponse`        |
| `POST /password/reset`          | `PasswordResetRequest`         | `PasswordResetResponse` |
| `POST /password/reset/complete` | `PasswordResetCompleteRequest` | Empty                   |
| `GET /session`                  | None                           | `SessionResponse`       |
| `GET /me`                       | None                           | `SessionResponse`       |
| `POST /logout`                  | None                           | Empty                   |
| `GET /wallet`                   | None                           | `WalletResponse`        |
| `GET /models`                   | None                           | `ModelsResponse`        |
| `GET /usage`                    | `PageQuery`                    | `UsageResponse`         |
| `GET /devices`                  | None                           | `DevicesResponse`       |
| `POST /devices/revoke`          | `RevokeDeviceRequest`          | `RevokeDeviceResponse`  |
| `GET /topup/options`            | None                           | `TopupOptionsResponse`  |
| `POST /topup/orders`            | `CreateTopupRequest`           | `TopupOrder`            |
| `GET /topup/orders`             | `PageQuery`                    | `TopupOrdersResponse`   |
| `GET /topup/orders/{order_id}`  | Path order ID                  | `TopupOrder`            |

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

## Proposed private gateway extension

The following **proposed** `/api/openh3/*` routes are a Core-to-gateway contract,
separate from both existing dashboard APIs and public renderer DTOs. Their
credentials must live in private Core adapter structs, never in
`openh3-api-types`. They require implementation and compatibility tests against
the pinned gateway before the product can claim support.

| Route                                                                                           | Private request/result                                                                                                                                                                                                                                                                            |
| ----------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `GET /capabilities`                                                                             | Native feature policy, anti-bot requirement, password encryption requirement/key metadata. Core projects only public capability fields.                                                                                                                                                           |
| `POST /email-code`                                                                              | Email plus purpose; returns an expiring opaque flow handle kept by Core. Response behavior must not enumerate registered addresses.                                                                                                                                                               |
| `POST /register`                                                                                | Username, email, password material, conditional flow handle/code; returns registered only. Uses existing user/wallet creation with atomic email-flow consumption; no permanent default token.                                                                                                     |
| `POST /login`                                                                                   | Username, password material and Core device metadata; returns a pending private credential bundle or verification flow.                                                                                                                                                                           |
| `POST /auth/verify`                                                                             | Private flow token and explicit factor method/material. Login uses existing login-verification machinery; reset/device reauthentication uses the shared security policy. Returns a pending login bundle, reset-ready proof, or completed device revocation according to the server-bound purpose. |
| `POST /password/reset`                                                                          | Email, private purpose-bound email flow and code; returns a reset-ready proof or required MFA flow. No new password yet.                                                                                                                                                                          |
| `POST /password/reset/complete`                                                                 | Private reset-ready proof and new password material; atomically consumes proof, changes password and advances security version, then invalidates auth caches/sessions/grants. Empty result.                                                                                                       |
| `POST /token`                                                                                   | Refresh credential and expected session/device identity; returns rotated private credential bundle using existing refresh machinery.                                                                                                                                                              |
| `POST /activate`                                                                                | Desktop access credential authenticates the pending device; idempotently returns the same private inference key, device ID and active session expiry after activation. No renderer key delivery.                                                                                                  |
| `POST /revoke`                                                                                  | Authenticated target device ID; starts purpose/target-bound reauthentication and revokes only an owned grant after proof, including its normal inference token. Session-authenticated logout can revoke the current device without asking the user to reauthenticate.                             |
| `GET /me`, `/wallet`, `/models`, `/usage`, `/devices`                                           | Desktop identity-scoped safe projections of the existing user, wallet/subscriptions/token, pricing and logs. Usage uses bounded numbered pagination.                                                                                                                                              |
| `GET /topup/options`, `POST /topup/orders`, `GET /topup/orders`, `GET /topup/orders/{order_id}` | Native projection over existing topup/payment services. Resolve options and idempotency on the server; check account ownership.                                                                                                                                                                   |

The draft private pending login bundle contains `state: "pending"`, `account` plus `credentials`
with `access_token`, `refresh_token`, `access_expires_at`, `session_expires_at`
and `device_id`. A verification result contains `flow_token`, `expires_at`, purpose and
methods; a ready reset result contains a private single-use `reset_proof` and expiry.
Core retains these fields and maps them to the public session state;
they are never serialized through the local response. Email flow tokens are
likewise retained under the local owner, normalized email and purpose. Exact
private field names must be matched by the gateway implementation and Core
adapter together; these are not upstream wire fixtures.

Extend the existing session machinery with a distinct desktop JWT audience and
server-side session/grant classification. Both refresh entry points must reject
the wrong session class **before** rotating or issuing credentials; a desktop
refresh credential must never mint a dashboard access token. Desktop access
tokens must fail dashboard/admin authorization, even when the underlying user
is an administrator. Conversely, dashboard tokens cannot activate a desktop
grant. Preserve auth-version checks and refresh replay handling rather than
building another refresh engine.

Each device grant is linked to a normal New API inference `Token`, the owning
user and the desktop session. Activation, expiration, user/security-version
changes and revocation must be enforced on inference requests, not only during
login. Persist the linkage and check grant/session state in the token-auth path;
merely returning an ordinary permanent key would bypass device revocation.
Provision/activate with retry-safe server state. The server enforces a five-minute
`pending_valid_until` for pending activation and an active session lifetime of
30 days; the precise storage relationship to `UserSession.ExpiresAt` is an
implementation detail to verify with the gateway. Activation returns the active
expiry. Core securely persists the pending bundle before
activation, then persists the inference key and active expiry before exposing
`connected`. Activation retries retrieve the same linked token key, so a crash
between server activation and local persistence is recoverable. Refresh reuses
the linked inference key and does not need to resend it; inference authorization
checks current session expiry and grant state on each request. Core securely
persists rotated credentials before exposing them as usable; persistence or activation
failure must leave no usable unowned credential. Clear local secrets on logout
and fail closed when a stored credential cannot be decrypted.

No second wallet, billing ledger or independent refresh/challenge engine is
introduced. Existing models/services remain authoritative; the extension adds
native projections, audience separation and device lifecycle constraints.

## Verification scope

`cloud_account_contract.rs` fixes public JSON shapes, string monetary quantities,
unknown-field rejection, state distinctions and the separation between
registration and login. Compile-fail documentation tests prevent password DTOs
from gaining `Debug` unnoticed. These checks do not verify authorization, CSRF,
remote audience isolation, expiry/replay, per-device inference revocation,
payment callbacks, decimal validation or real gateway compatibility. Those need
route/service tests and pinned gateway integration tests as implementations land.

This DTO-only change needs no runtime logging. The implementation should record
sanitized lifecycle outcomes and non-sensitive correlation IDs, never passwords,
codes, flow/access/refresh/inference tokens, raw remote responses or checkout
URLs. Audit financial transitions through existing gateway billing observability.
