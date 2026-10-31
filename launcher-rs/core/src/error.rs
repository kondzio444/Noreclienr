//! One error type for the whole backend. Every message a player can see is Polish, like the
//! Electron launcher's; the IPC layer turns an [`Error`] into its `Display` text.

use std::fmt;

/// Text of every channel that is not ported to Rust yet (see PORTING.md).
pub const PENDING: &str = "Funkcja w przygotowaniu w wersji Rust";

#[derive(Debug, thiserror::Error)]
pub enum Error {
    /// A message for the player, shown as is.
    #[error("{0}")]
    Msg(String),
    /// The premium session cannot be refreshed: the player has to log in again.
    #[error("{0}")]
    Auth(String),
    #[error("HTTP {status} dla {url}")]
    Status { status: u16, url: String },
    #[error("Brak połączenia: {0}")]
    Http(#[from] reqwest::Error),
    #[error("Błąd pliku: {0}")]
    Io(#[from] std::io::Error),
    #[error("Błędne dane JSON: {0}")]
    Json(#[from] serde_json::Error),
    #[error("Uszkodzone archiwum: {0}")]
    Zip(#[from] zip::result::ZipError),
    #[error("Anulowano")]
    Cancelled,
    /// A channel of the Electron launcher that phase 1 of the Rust port does not cover yet.
    #[error("{PENDING} ({0}).")]
    Pending(String),
}

pub type Result<T, E = Error> = std::result::Result<T, E>;

/// Shorthand for a player-facing message.
pub fn msg(text: impl Into<String>) -> Error {
    Error::Msg(text.into())
}

impl Error {
    /// True when the error means the Microsoft session is gone (log in again).
    pub fn is_auth(&self) -> bool {
        matches!(self, Error::Auth(_))
    }

    /// True for connection problems (offline, DNS, timeouts) – not for answers of a server.
    pub fn is_network(&self) -> bool {
        match self {
            Error::Http(e) => e.is_connect() || e.is_timeout() || e.is_request(),
            Error::Io(e) => matches!(
                e.kind(),
                std::io::ErrorKind::ConnectionRefused | std::io::ErrorKind::ConnectionReset | std::io::ErrorKind::TimedOut | std::io::ErrorKind::NotConnected
            ),
            _ => false,
        }
    }
}

/// `Option` → player-facing error.
pub trait OrMsg<T> {
    fn or_msg(self, text: &str) -> Result<T>;
}

impl<T> OrMsg<T> for Option<T> {
    fn or_msg(self, text: &str) -> Result<T> {
        self.ok_or_else(|| msg(text))
    }
}

/// Wraps any displayable error as a message (for third-party errors without a `From`).
pub fn wrap(e: impl fmt::Display) -> Error {
    Error::Msg(e.to_string())
}
