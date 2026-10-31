use crate::{Result, payload::RequestRecord};
use rusqlite::{Connection, TransactionBehavior, params};
use std::path::Path;

pub const MAX_ID: u32 = 0x00ff_ffff;

/// SQLite commits the new session before it can be used on the wire. Concurrent
/// app processes obtain separate sessions under an IMMEDIATE transaction.
pub struct IdentityStore {
    db: Connection,
    pub session: u32,
    sequence: u32,
}
impl IdentityStore {
    pub fn open(path: &Path) -> Result<Self> {
        if let Some(parent) = path.parent() {
            std::fs::create_dir_all(parent).map_err(|e| e.to_string())?;
        }
        let mut db = Connection::open(path).map_err(|e| e.to_string())?;
        db.busy_timeout(std::time::Duration::from_millis(500))
            .map_err(|e| e.to_string())?;
        db.execute_batch("PRAGMA journal_mode=WAL; PRAGMA synchronous=FULL;
            CREATE TABLE IF NOT EXISTS identity (id INTEGER PRIMARY KEY CHECK(id=1), session INTEGER NOT NULL);
            CREATE TABLE IF NOT EXISTS requests (id TEXT PRIMARY KEY, body TEXT NOT NULL, updated INTEGER NOT NULL);
            CREATE TABLE IF NOT EXISTS metadata (id TEXT PRIMARY KEY, body TEXT NOT NULL);")
            .map_err(|e|e.to_string())?;
        let tx = db
            .transaction_with_behavior(TransactionBehavior::Immediate)
            .map_err(|e| e.to_string())?;
        let old: u32 = tx
            .query_row(
                "SELECT COALESCE((SELECT session FROM identity WHERE id=1),0)",
                [],
                |r| r.get(0),
            )
            .map_err(|e| e.to_string())?;
        if old >= MAX_ID {
            return Err("请求会话已用尽，需要迁移发送方身份".into());
        }
        let session = old + 1;
        tx.execute("INSERT OR REPLACE INTO identity VALUES (1,?1)", [session])
            .map_err(|e| e.to_string())?;
        tx.commit().map_err(|e| e.to_string())?;
        Ok(Self {
            db,
            session,
            sequence: 0,
        })
    }
    pub fn next_request(&mut self) -> Result<(u32, u32)> {
        if self.sequence >= MAX_ID {
            return Err("本会话请求序号已用尽，请重新启动应用".into());
        }
        self.sequence += 1;
        Ok((self.session, self.sequence))
    }
    pub fn save(&self, r: &RequestRecord) -> Result<()> {
        let body = serde_json::to_string(r).map_err(|e| e.to_string())?;
        self.db
            .execute(
                "INSERT OR REPLACE INTO requests VALUES (?1,?2,?3)",
                params![r.id, body, r.created_unix_ms as i64],
            )
            .map_err(|e| e.to_string())?;
        Ok(())
    }
    pub fn load(&self) -> Result<Vec<RequestRecord>> {
        let mut statement=self.db.prepare("SELECT body FROM requests WHERE json_extract(body,'$.retired')=0 OR id IN (SELECT id FROM requests ORDER BY updated DESC LIMIT 2000) ORDER BY updated ASC, rowid ASC").map_err(|e|e.to_string())?;
        let rows = statement
            .query_map([], |r| r.get::<_, String>(0))
            .map_err(|e| e.to_string())?;
        rows.map(|r| {
            serde_json::from_str(&r.map_err(|e| e.to_string())?).map_err(|e| e.to_string())
        })
        .collect()
    }
    pub fn save_state(
        &self,
        records: &[RequestRecord],
        safety: &impl serde::Serialize,
    ) -> Result<()> {
        let tx = self.db.unchecked_transaction().map_err(|e| e.to_string())?;
        {
            let mut stmt=tx.prepare("INSERT INTO requests VALUES (?1,?2,?3) ON CONFLICT(id) DO UPDATE SET body=excluded.body, updated=excluded.updated WHERE requests.body<>excluded.body").map_err(|e|e.to_string())?;
            for r in records {
                stmt.execute(params![
                    r.id,
                    serde_json::to_string(r).map_err(|e| e.to_string())?,
                    r.created_unix_ms as i64
                ])
                .map_err(|e| e.to_string())?;
            }
        }
        tx.execute(
            "INSERT OR REPLACE INTO metadata VALUES ('safety',?1)",
            [serde_json::to_string(safety).map_err(|e| e.to_string())?],
        )
        .map_err(|e| e.to_string())?;
        tx.commit().map_err(|e| e.to_string())?;
        Ok(())
    }
    pub fn set_meta(&self, key: &str, value: &impl serde::Serialize) -> Result<()> {
        let body = serde_json::to_string(value).map_err(|e| e.to_string())?;
        self.db
            .execute(
                "INSERT OR REPLACE INTO metadata VALUES (?1,?2)",
                params![key, body],
            )
            .map_err(|e| e.to_string())?;
        Ok(())
    }
    pub fn meta<T: serde::de::DeserializeOwned + Default>(&self, key: &str) -> Result<T> {
        use rusqlite::OptionalExtension;
        let text: Option<String> = self
            .db
            .query_row("SELECT body FROM metadata WHERE id=?1", [key], |r| r.get(0))
            .optional()
            .map_err(|e| e.to_string())?;
        text.map_or_else(
            || Ok(T::default()),
            |s| serde_json::from_str(&s).map_err(|e| e.to_string()),
        )
    }
}
