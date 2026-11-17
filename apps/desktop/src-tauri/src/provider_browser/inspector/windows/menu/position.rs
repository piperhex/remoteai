use webview2_com::Microsoft::Web::WebView2::Win32::*;
use windows::{
    core::{Error, Interface, Result},
    Win32::{
        Foundation::{HWND, POINT, RECT},
        Graphics::Gdi::ClientToScreen,
    },
};

pub(super) fn screen_point(
    controller: &ICoreWebView2Controller,
    args: &ICoreWebView2ContextMenuRequestedEventArgs,
) -> Result<POINT> {
    // SAFETY: Read the request and controller on their owning COM apartment before deferring.
    unsafe {
        let mut location = POINT::default();
        args.Location(&mut location)?;
        let mut bounds = RECT::default();
        controller.Bounds(&mut bounds)?;
        let controller3 = controller.cast::<ICoreWebView2Controller3>()?;
        let mut scale = 1.0;
        controller3.RasterizationScale(&mut scale)?;
        let mut mode = COREWEBVIEW2_BOUNDS_MODE_USE_RAW_PIXELS;
        controller3.BoundsMode(&mut mode)?;
        let bounds_scale = if mode == COREWEBVIEW2_BOUNDS_MODE_USE_RASTERIZATION_SCALE {
            scale
        } else {
            1.0
        };
        let mut point = parent_client_point(location, bounds, scale, bounds_scale);
        let mut parent = HWND::default();
        controller.ParentWindow(&mut parent)?;
        if !ClientToScreen(parent, &mut point).as_bool() {
            return Err(Error::from_win32());
        }
        Ok(point)
    }
}

fn parent_client_point(location: POINT, bounds: RECT, scale: f64, bounds_scale: f64) -> POINT {
    // Location is in WebView DIPs, already accounting for page zoom. Wry uses raw physical
    // controller bounds. Scale the event once, then add the independently scaled client origin.
    // Use the event anchor for mouse, touch and keyboard alike; the OS cursor may be elsewhere.
    POINT {
        x: (location.x as f64 * scale).round() as i32
            + (bounds.left as f64 * bounds_scale).round() as i32,
        y: (location.y as f64 * scale).round() as i32
            + (bounds.top as f64 * bounds_scale).round() as i32,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn menu_anchor_scales_event_without_scaling_physical_webview_offset() {
        let bounds = RECT {
            left: 238,
            top: 179,
            ..RECT::default()
        };
        for (scale, expected) in [
            (1.0, (518, 379)),
            (1.25, (588, 429)),
            (1.5, (658, 479)),
            (2.0, (798, 579)),
        ] {
            let point = parent_client_point(POINT { x: 280, y: 200 }, bounds, scale, 1.0);
            assert_eq!((point.x, point.y), expected);
        }
    }

    #[test]
    fn menu_anchor_supports_logical_bounds_and_negative_offsets() {
        let bounds = RECT {
            left: -200,
            top: 102,
            ..RECT::default()
        };
        let point = parent_client_point(POINT { x: 83, y: 71 }, bounds, 1.5, 1.5);
        assert_eq!((point.x, point.y), (-175, 260));
    }
}
