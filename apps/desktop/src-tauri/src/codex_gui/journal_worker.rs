//! A single owner applies journal operations in submission order. Sending a job never waits for I/O.
use std::{io, sync::mpsc, thread};
use tokio::sync::oneshot;

type Job<T> = Box<dyn FnOnce(&mut T) + Send>;

pub(super) struct JournalWorker<T>(mpsc::Sender<Job<T>>);

impl<T: Send + 'static> JournalWorker<T> {
    pub(super) fn start(name: &str, mut state: T) -> io::Result<Self> {
        let (sender, jobs) = mpsc::channel::<Job<T>>();
        thread::Builder::new().name(name.into()).spawn(move || {
            for job in jobs {
                job(&mut state);
            }
        })?;
        Ok(Self(sender))
    }

    pub(super) fn submit(&self, job: impl FnOnce(&mut T) + Send + 'static) -> Result<(), ()> {
        self.0.send(Box::new(job)).map_err(|_| ())
    }

    pub(super) async fn call<R: Send + 'static>(
        &self,
        job: impl FnOnce(&mut T) -> R + Send + 'static,
    ) -> Result<R, ()> {
        let (done, result) = oneshot::channel();
        self.submit(move |state| {
            // The operation is still ordered and durable if the caller goes away.
            let _ = done.send(job(state));
        })?;
        result.await.map_err(|_| ())
    }
}
