use super::*;
use russh_sftp::protocol::{FileAttributes, Name, Status, StatusCode};
use std::time::Duration;
use tokio::sync::Notify;

// Pause a real SFTP exchange after the server has received the operation.
struct PausedSftp {
    started: Option<oneshot::Sender<()>>,
    resume: Arc<Notify>,
}

impl PausedSftp {
    async fn wait(&mut self) {
        self.started.take().unwrap().send(()).unwrap();
        self.resume.notified().await;
    }
}

impl russh_sftp::server::Handler for PausedSftp {
    type Error = StatusCode;
    fn unimplemented(&self) -> StatusCode {
        StatusCode::OpUnsupported
    }
    async fn realpath(&mut self, _: u32, _: String) -> std::result::Result<Name, StatusCode> {
        self.wait().await;
        Err(StatusCode::Failure)
    }
    async fn mkdir(
        &mut self,
        _: u32,
        _: String,
        _: FileAttributes,
    ) -> std::result::Result<Status, StatusCode> {
        self.wait().await;
        Err(StatusCode::Failure)
    }
}

async fn fixture() -> (SftpSession, oneshot::Receiver<()>, Arc<Notify>) {
    let (client, server) = tokio::io::duplex(4096);
    let (started, received) = oneshot::channel();
    let resume = Arc::new(Notify::new());
    let handler = PausedSftp {
        started: Some(started),
        resume: Arc::clone(&resume),
    };
    russh_sftp::server::run(server, handler).await;
    (SftpSession::new(client).await.unwrap(), received, resume)
}

#[tokio::test]
async fn caller_departure_cancels_a_stalled_list_and_discards_its_channel() {
    let (sftp, started, resume) = fixture().await;
    let (_stop, mut closing) = watch::channel(());
    let (reply, result) = oneshot::channel();
    let request = Request {
        action: FileAction::List { path: ".".into() },
        deadline: Instant::now() + TIMEOUT,
        reply,
    };
    let mut uploads = Uploads::default();
    let (keep_channel, ()) =
        tokio::join!(perform(&sftp, &mut uploads, request, &mut closing), async {
            started.await.unwrap();
            drop(result);
        });
    assert!(!keep_channel);
    resume.notify_one();
}

#[tokio::test]
async fn read_deadline_expires_while_the_server_is_still_processing_it() {
    let (sftp, mut started, resume) = fixture().await;
    let (_stop, mut closing) = watch::channel(());
    let (reply, result) = oneshot::channel();
    let request = Request {
        action: FileAction::List { path: ".".into() },
        deadline: Instant::now() + Duration::from_millis(250),
        reply,
    };
    let mut uploads = Uploads::default();
    let keep_channel = perform(&sftp, &mut uploads, request, &mut closing).await;
    started.try_recv().unwrap();
    assert!(!keep_channel);
    assert!(matches!(result.await.unwrap(), Err(Error::File)));
    resume.notify_one();
}

#[tokio::test]
async fn started_mutation_stays_owned_until_the_server_replies_after_caller_leaves() {
    let (sftp, started, resume) = fixture().await;
    let (stop, mut closing) = watch::channel(());
    let (reply, result) = oneshot::channel();
    let request = Request {
        action: FileAction::CreateFolder {
            path: "/example".into(),
        },
        deadline: Instant::now() + TIMEOUT,
        reply,
    };
    let task = tokio::spawn(async move {
        perform(&sftp, &mut Uploads::default(), request, &mut closing).await
    });
    started.await.unwrap();
    drop(result);
    drop(stop);
    let mut task = task;
    assert!(timeout(Duration::from_millis(20), &mut task).await.is_err());
    resume.notify_one();
    assert!(task.await.unwrap());
}

#[tokio::test]
async fn full_queue_rejects_retries_without_starting_more_work() {
    let (sender, mut queue) = mpsc::channel(FILE_QUEUE_CAPACITY);
    let requests = FileRequests(sender);
    let action = || FileAction::List { path: ".".into() };
    let caller = async { requests.perform(action()).await };
    let another = async { requests.perform(action()).await };
    tokio::select! {
        biased;
        _ = caller => panic!("first request must be pending"),
        _ = another => panic!("second request must be pending"),
        result = requests.perform(action()) => assert!(matches!(result, Err(Error::FileBusy))),
    }
    assert_eq!(queue.len(), FILE_QUEUE_CAPACITY);
    while let Ok(request) = queue.try_recv() {
        assert!(
            request.expired(),
            "queued requests are skipped after the caller leaves"
        );
    }
}
