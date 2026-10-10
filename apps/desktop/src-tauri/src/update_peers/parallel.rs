//! Each isolated connection downloads a disjoint range. Only a complete, verified package is usable.
use futures_util::future::try_join_all;

use super::{
    signaling::Lease,
    transfer::{self, Part, Piece},
    Error, Result, MAX_DOWNLOAD_PEERS,
};

pub(super) async fn download(
    leases: &[Lease],
    artifact: &str,
    mut progress: impl FnMut(usize, Option<u64>),
) -> Result<Vec<u8>> {
    if leases.is_empty() || leases.len() > MAX_DOWNLOAD_PEERS {
        return Err(Error::Unavailable);
    }
    if leases.len() == 1 {
        return transfer::download(&leases[0].connection, artifact, progress).await;
    }
    let (sender, mut receiver) = tokio::sync::mpsc::unbounded_channel();
    let parts = leases.iter().enumerate().map(|(index, lease)| {
        let sender = sender.clone();
        transfer::download_part(
            &lease.connection,
            artifact,
            Part {
                index,
                count: leases.len(),
            },
            move |length, total| {
                let _delivered = sender.send((length, total));
            },
        )
    });
    let pending = try_join_all(parts);
    tokio::pin!(pending);
    let pieces = loop {
        tokio::select! {
            result = &mut pending => break result?,
            Some((length, total)) = receiver.recv() => progress(length, total),
        }
    };
    while let Ok((length, total)) = receiver.try_recv() {
        progress(length, total);
    }
    assemble(pieces)
}

fn assemble(pieces: Vec<Piece>) -> Result<Vec<u8>> {
    let total = pieces.first().ok_or(Error::Invalid)?.total;
    let mut bytes = Vec::new();
    for piece in pieces {
        if piece.total != total || piece.offset != bytes.len() {
            return Err(Error::Invalid);
        }
        bytes.extend_from_slice(&piece.bytes);
    }
    if bytes.len() != total {
        return Err(Error::Invalid);
    }
    Ok(bytes)
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn ranges_cover_uneven_packages_and_reject_gaps_or_inconsistent_sizes() {
        let pieces = (0..3)
            .map(|index| {
                let range = Part { index, count: 3 }.range(100).unwrap();
                Piece {
                    total: 100,
                    offset: range.start,
                    bytes: vec![index as u8; range.len()],
                }
            })
            .collect();
        assert_eq!(assemble(pieces).unwrap().len(), 100);
        assert!(assemble(vec![Piece {
            total: 9,
            offset: 0,
            bytes: vec![0; 8]
        }])
        .is_err());
        assert!(assemble(vec![Piece {
            total: 9,
            offset: 1,
            bytes: vec![0; 9]
        }])
        .is_err());
        assert!(Part { index: 3, count: 3 }.range(100).is_err());
        assert!(Part { index: 0, count: 4 }.range(100).is_err());
    }
}
