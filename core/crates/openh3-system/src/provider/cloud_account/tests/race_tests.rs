use super::*;
use openh3_db::{CloudAccountRow, DbError, SaveCloudAccount};
use std::sync::atomic::{AtomicU8, Ordering};
use tokio::sync::Notify;

const INITIALIZE: u8 = 1;
const ADMIT: u8 = 2;
const DISCONNECT: u8 = 3;

/// Scheduling wrapper only; every operation still executes real SQLite SQL.
struct RepositoryBarrier {
    inner: SqliteCloudAccountRepository,
    armed: AtomicU8,
    held: Notify,
    release: Notify,
}
impl RepositoryBarrier {
    async fn pause(&self, operation: u8) {
        if self
            .armed
            .compare_exchange(operation, 0, Ordering::SeqCst, Ordering::SeqCst)
            .is_ok()
        {
            self.held.notify_one();
            self.release.notified().await;
        }
    }
    async fn wait(&self) {
        tokio::time::timeout(std::time::Duration::from_secs(5), self.held.notified())
            .await
            .unwrap();
    }
}
#[async_trait::async_trait]
impl ICloudAccountRepository for RepositoryBarrier {
    async fn load(&self, owner: &str, issuer: &str) -> std::result::Result<Option<CloudAccountRow>, DbError> {
        self.inner.load(owner, issuer).await
    }
    async fn ensure_generation(&self, owner: &str, issuer: &str) -> std::result::Result<i64, DbError> {
        self.pause(INITIALIZE).await;
        self.inner.ensure_generation(owner, issuer).await
    }
    async fn begin_login(&self, owner: &str, issuer: &str) -> std::result::Result<i64, DbError> {
        self.pause(ADMIT).await;
        self.inner.begin_login(owner, issuer).await
    }
    async fn disconnect(&self, owner: &str, issuer: &str) -> std::result::Result<CloudAccountRow, DbError> {
        self.pause(DISCONNECT).await;
        self.inner.disconnect(owner, issuer).await
    }
    async fn invalidate(
        &self,
        owner: &str,
        issuer: &str,
        expected: Option<i64>,
        reauth: bool,
    ) -> std::result::Result<i64, DbError> {
        self.inner.invalidate(owner, issuer, expected, reauth).await
    }
    async fn save_pending(&self, p: SaveCloudAccount<'_>) -> std::result::Result<(), DbError> {
        self.inner.save_pending(p).await
    }
    async fn save_active(&self, p: SaveCloudAccount<'_>) -> std::result::Result<(), DbError> {
        self.inner.save_active(p).await
    }
}
async fn fixture_with_barrier(
    endpoint: String,
    operation: u8,
) -> (
    openh3_db::Database,
    Arc<RepositoryBarrier>,
    Arc<CloudAccountService>,
    String,
) {
    let db = init_database_memory().await.unwrap();
    let owner: String = sqlx::query_scalar("SELECT id FROM users LIMIT 1")
        .fetch_one(db.pool())
        .await
        .unwrap();
    let repo = Arc::new(RepositoryBarrier {
        inner: SqliteCloudAccountRepository::new(db.pool().clone()),
        armed: AtomicU8::new(operation),
        held: Notify::new(),
        release: Notify::new(),
    });
    let svc = Arc::new(
        CloudAccountService::new(
            repo.clone(),
            [7; 32],
            CloudAccountConfig {
                enabled: true,
                endpoint: Some(endpoint),
                allow_insecure_loopback: true,
            },
        )
        .unwrap(),
    );
    (db, repo, svc, owner)
}
fn start_login(
    svc: &Arc<CloudAccountService>,
    owner: &str,
) -> tokio::task::JoinHandle<Result<CloudAccountSessionResponse>> {
    let svc = svc.clone();
    let owner = owner.to_owned();
    tokio::spawn(async move { svc.login(&owner, login()).await })
}

#[tokio::test]
async fn atomic_initialization_preserves_login_that_commits_first() {
    let (endpoint, mut rx, server) = barrier_gateway().await;
    let (_db, repo, svc, owner) = fixture_with_barrier(endpoint, INITIALIZE).await;
    let email = {
        let svc = svc.clone();
        let owner = owner.clone();
        tokio::spawn(async move {
            svc.email_code(
                &owner,
                CloudAccountEmailCodeRequest {
                    email: "alice@example.com".into(),
                    purpose: CloudAccountEmailCodePurpose::Registration,
                },
            )
            .await
        })
    };
    repo.wait().await;
    let login = start_login(&svc, &owner);
    exchange(&mut rx, "capabilities")
        .await
        .respond
        .send(capabilities())
        .unwrap();
    exchange(&mut rx, "login").await.respond.send(pending()).unwrap();
    exchange(&mut rx, "activate").await.respond.send(active()).unwrap();
    login.await.unwrap().unwrap();
    let before = svc.read(&owner).await.unwrap().unwrap();
    repo.release.notify_one();
    exchange(&mut rx, "capabilities")
        .await
        .respond
        .send(capabilities())
        .unwrap();
    exchange(&mut rx, "email-code").await.respond.send(json!({"state":"code_sent","purpose":"openh3_register_email","flow_token":"email-flow","expires_at":now()+600,"resend_at":now()+60,"methods":null})).unwrap();
    email.await.unwrap().unwrap();
    let after = svc.read(&owner).await.unwrap().unwrap();
    assert_eq!(after.generation, before.generation);
    assert_eq!(after.provider_id, before.provider_id);
    assert!(matches!(
        svc.session(&owner).await.unwrap(),
        CloudAccountSessionResponse::Connected { .. }
    ));
    assert!(rx.try_recv().is_err());
    server.abort();
}

#[tokio::test]
async fn atomic_login_admission_rejects_grant_committed_while_waiting() {
    for activate_first in [false, true] {
        let (endpoint, mut rx, server) = barrier_gateway().await;
        let (db, repo, svc, owner) = fixture_with_barrier(endpoint, 0).await;
        let first = start_login(&svc, &owner);
        exchange(&mut rx, "capabilities")
            .await
            .respond
            .send(capabilities())
            .unwrap();
        let first_login = exchange(&mut rx, "login").await;
        repo.armed.store(ADMIT, Ordering::SeqCst);
        let second = start_login(&svc, &owner);
        repo.wait().await;
        first_login.respond.send(pending()).unwrap();
        let mut activation = Some(exchange(&mut rx, "activate").await);
        let mut first = Some(first);
        let first_stored = svc.read(&owner).await.unwrap().unwrap();
        if activate_first {
            activation.take().unwrap().respond.send(active()).unwrap();
            first.take().unwrap().await.unwrap().unwrap();
        }
        repo.release.notify_one();
        assert_eq!(second.await.unwrap().unwrap_err(), CloudAccountError::Conflict);
        let current = svc.read(&owner).await.unwrap().unwrap();
        assert_eq!(current.provider_id, first_stored.provider_id);
        assert_eq!(current.generation, first_stored.generation);
        if let Some(activation) = activation {
            activation.respond.send(active()).unwrap();
            first.take().unwrap().await.unwrap().unwrap();
        }
        let count: i64 = sqlx::query_scalar("SELECT count(*) FROM providers WHERE managed_by='cloud_account'")
            .fetch_one(db.pool())
            .await
            .unwrap();
        assert_eq!(count, 1);
        assert!(rx.try_recv().is_err());
        server.abort();
    }
}

#[tokio::test]
async fn atomic_admission_that_commits_first_fences_older_login() {
    let (endpoint, mut rx, server) = barrier_gateway().await;
    let (db, _repo, svc, owner) = fixture_with_barrier(endpoint, 0).await;
    let first = start_login(&svc, &owner);
    exchange(&mut rx, "capabilities")
        .await
        .respond
        .send(capabilities())
        .unwrap();
    let old_login = exchange(&mut rx, "login").await;
    let second = start_login(&svc, &owner);
    exchange(&mut rx, "capabilities")
        .await
        .respond
        .send(capabilities())
        .unwrap();
    let new_login = exchange(&mut rx, "login").await;
    old_login.respond.send(pending()).unwrap();
    assert_eq!(first.await.unwrap().unwrap_err(), CloudAccountError::Conflict);
    new_login.respond.send(pending()).unwrap();
    exchange(&mut rx, "activate").await.respond.send(active()).unwrap();
    second.await.unwrap().unwrap();
    let count: i64 = sqlx::query_scalar("SELECT count(*) FROM providers WHERE managed_by='cloud_account'")
        .fetch_one(db.pool())
        .await
        .unwrap();
    assert_eq!(count, 1);
    assert!(rx.try_recv().is_err());
    server.abort();
}

#[tokio::test]
async fn atomic_logout_revokes_grant_committed_while_waiting() {
    let server = MockServer::start().await;
    let (_db, repo, svc, owner) = fixture_with_barrier(server.uri(), DISCONNECT).await;
    Mock::given(method("GET"))
        .and(path("/api/openh3/capabilities"))
        .respond_with(ok(capabilities()))
        .mount(&server)
        .await;
    let generation = repo
        .inner
        .begin_login(&owner, svc.gateway().unwrap().issuer())
        .await
        .unwrap();
    let logout = {
        let svc = svc.clone();
        let owner = owner.clone();
        tokio::spawn(async move { svc.logout(&owner).await })
    };
    repo.wait().await;
    // Pending persistence can finish independently of the in-memory flow lock.
    Mock::given(method("POST"))
        .and(path("/api/openh3/activate"))
        .respond_with(ok(active()))
        .expect(1)
        .mount(&server)
        .await;
    let result: wire::AuthResult = serde_json::from_value(pending()).unwrap();
    svc.login_result(&owner, generation, "issued-request", result)
        .await
        .unwrap();
    Mock::given(method("POST"))
        .and(path("/api/openh3/revoke"))
        .and(wiremock::matchers::body_partial_json(json!({"device_id":"device-1"})))
        .and(wiremock::matchers::header("authorization", "Bearer desktop-secret"))
        .respond_with(ok(json!({"state":"revoked"})))
        .expect(1)
        .mount(&server)
        .await;
    repo.release.notify_one();
    assert_eq!(
        logout.await.unwrap().unwrap().remote_revocation,
        CloudAccountRemoteRevocation::Confirmed
    );
    assert!(matches!(
        svc.session(&owner).await.unwrap(),
        CloudAccountSessionResponse::Disconnected {}
    ));
}
