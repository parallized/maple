use serde::Deserialize;
use tauri::{
    image::Image,
    tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent},
    AppHandle, Manager,
};

const TRAY_ID: &str = "maple-task-status";
const ICON_SIZE: u32 = 32;

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TrayTaskSnapshot {
    pub unresolved_count: u32,
    pub in_progress_count: u32,
    pub queued_count: u32,
    pub todo_count: u32,
    pub need_info_count: u32,
    pub confirm_count: u32,
    pub blocked_count: u32,
    pub completed_count: u32,
}

#[derive(Clone, Copy)]
enum AggregateStatus {
    Confirm,
    InProgress,
    Queued,
    Todo,
    NeedInfo,
    Blocked,
    Done,
}

impl AggregateStatus {
    fn label(self) -> &'static str {
        match self {
            AggregateStatus::Confirm => "待确认",
            AggregateStatus::InProgress => "进行中",
            AggregateStatus::Queued => "队列中",
            AggregateStatus::Todo => "待办",
            AggregateStatus::NeedInfo => "需要更多信息",
            AggregateStatus::Blocked => "已阻塞",
            AggregateStatus::Done => "已完成",
        }
    }

    fn color(self) -> [u8; 4] {
        match self {
            AggregateStatus::Confirm => [233, 151, 0, 255],
            AggregateStatus::InProgress => [31, 111, 235, 255],
            AggregateStatus::Queued => [233, 151, 0, 255],
            AggregateStatus::Todo => [202, 135, 0, 255],
            AggregateStatus::NeedInfo => [242, 139, 58, 255],
            AggregateStatus::Blocked => [215, 68, 68, 255],
            AggregateStatus::Done => [76, 169, 94, 255],
        }
    }
}

pub fn init(app_handle: &AppHandle) -> tauri::Result<()> {
    if app_handle.tray_by_id(TRAY_ID).is_some() {
        return Ok(());
    }

    let _tray = TrayIconBuilder::with_id(TRAY_ID)
        .icon(render_idle_icon())
        .tooltip("Maple · 暂无任务")
        .show_menu_on_left_click(false)
        .on_tray_icon_event(|tray, event| {
            if let TrayIconEvent::Click {
                button: MouseButton::Left,
                button_state: MouseButtonState::Up,
                ..
            } = event
            {
                if let Some(window) = tray.app_handle().get_webview_window("main") {
                    let _ = window.unminimize();
                    let _ = window.show();
                    let _ = window.set_focus();
                }
            }
        })
        .build(app_handle)?;

    #[cfg(target_os = "macos")]
    {
        let _ = _tray.set_title(Some("0"));
    }

    Ok(())
}

pub fn sync(app_handle: &AppHandle, snapshot: &TrayTaskSnapshot) -> tauri::Result<()> {
    if app_handle.tray_by_id(TRAY_ID).is_none() {
        init(app_handle)?;
    }

    let Some(tray) = app_handle.tray_by_id(TRAY_ID) else {
        return Ok(());
    };

    let status = aggregate_status(snapshot);
    let icon = render_tray_icon(snapshot, status);
    tray.set_icon(Some(icon))?;
    tray.set_tooltip(Some(build_tooltip(snapshot, status).as_str()))?;

    #[cfg(target_os = "macos")]
    {
        let title = format_badge_count(snapshot.unresolved_count);
        let _ = tray.set_title(Some(title));
    }

    Ok(())
}

fn aggregate_status(snapshot: &TrayTaskSnapshot) -> AggregateStatus {
    if snapshot.confirm_count > 0 {
        AggregateStatus::Confirm
    } else if snapshot.need_info_count > 0 {
        AggregateStatus::NeedInfo
    } else if snapshot.in_progress_count > 0 {
        AggregateStatus::InProgress
    } else if snapshot.queued_count > 0 {
        AggregateStatus::Queued
    } else if snapshot.todo_count > 0 {
        AggregateStatus::Todo
    } else if snapshot.blocked_count > 0 {
        AggregateStatus::Blocked
    } else {
        AggregateStatus::Done
    }
}

fn build_tooltip(snapshot: &TrayTaskSnapshot, status: AggregateStatus) -> String {
    if snapshot.unresolved_count == 0 {
        return format!(
            "Maple · {} · 全部完成\n已完成 {}",
            status.label(),
            snapshot.completed_count
        );
    }

    format!(
        "Maple · {} · 待处理 {}\n待确认 {} · 检查 {} · 进行中 {} · 队列中 {} · 待办 {} · 已阻塞 {} · 已完成 {}",
        status.label(),
        snapshot.unresolved_count,
        snapshot.confirm_count,
        snapshot.need_info_count,
        snapshot.in_progress_count,
        snapshot.queued_count,
        snapshot.todo_count,
        snapshot.blocked_count,
        snapshot.completed_count
    )
}

#[cfg(target_os = "macos")]
fn format_badge_count(count: u32) -> String {
    if count > 99 {
        "99+".to_string()
    } else {
        count.to_string()
    }
}

fn has_attention(snapshot: &TrayTaskSnapshot) -> bool {
    snapshot.confirm_count > 0 || snapshot.need_info_count > 0
}

fn render_idle_icon() -> Image<'static> {
    render_empty_circle_icon([160, 160, 160, 220])
}

fn render_tray_icon(snapshot: &TrayTaskSnapshot, _status: AggregateStatus) -> Image<'static> {
    if has_attention(snapshot) {
        return render_check_icon();
    }
    render_overview_pie_icon(snapshot)
}

fn render_empty_circle_icon(color: [u8; 4]) -> Image<'static> {
    let mut rgba = vec![0u8; (ICON_SIZE * ICON_SIZE * 4) as usize];

    draw_circle(
        &mut rgba,
        (ICON_SIZE / 2) as i32,
        (ICON_SIZE / 2) as i32,
        (ICON_SIZE as i32 / 2) - 1,
        color,
    );

    Image::new_owned(rgba, ICON_SIZE, ICON_SIZE)
}

fn render_check_icon() -> Image<'static> {
    let mut rgba = vec![0u8; (ICON_SIZE * ICON_SIZE * 4) as usize];

    draw_circle(
        &mut rgba,
        (ICON_SIZE / 2) as i32,
        (ICON_SIZE / 2) as i32,
        (ICON_SIZE as i32 / 2) - 1,
        [0, 0, 0, 255],
    );

    draw_check_mark(&mut rgba, [255, 255, 255, 255]);
    Image::new_owned(rgba, ICON_SIZE, ICON_SIZE)
}

fn render_overview_pie_icon(snapshot: &TrayTaskSnapshot) -> Image<'static> {
    let segments: [(u32, [u8; 4]); 5] = [
        (snapshot.in_progress_count, AggregateStatus::InProgress.color()),
        (snapshot.queued_count, AggregateStatus::Queued.color()),
        (snapshot.todo_count, AggregateStatus::Todo.color()),
        (snapshot.blocked_count, AggregateStatus::Blocked.color()),
        (snapshot.completed_count, AggregateStatus::Done.color()),
    ];
    render_pie_icon(&segments, true)
}

fn render_pie_icon(segments: &[(u32, [u8; 4])], highlight: bool) -> Image<'static> {
    let total: u32 = segments.iter().map(|(value, _)| *value).sum();
    if total == 0 {
        return render_idle_icon();
    }

    let cx = ICON_SIZE as f32 / 2.0;
    let cy = ICON_SIZE as f32 / 2.0;
    let radius = (ICON_SIZE as f32 / 2.0) - 1.0;
    let radius_sq = radius * radius;
    let tau = std::f32::consts::PI * 2.0;

    let mut boundaries: Vec<(f32, [u8; 4])> = Vec::with_capacity(segments.len());
    let mut acc = 0.0;
    for (value, color) in segments {
        if *value == 0 {
            continue;
        }
        acc += (*value as f32 / total as f32) * tau;
        boundaries.push((acc, *color));
    }

    if boundaries.is_empty() {
        return render_idle_icon();
    }

    let mut rgba = vec![0u8; (ICON_SIZE * ICON_SIZE * 4) as usize];
    for y in 0..(ICON_SIZE as i32) {
        for x in 0..(ICON_SIZE as i32) {
            let fx = x as f32 + 0.5;
            let fy = y as f32 + 0.5;
            let dx = fx - cx;
            let dy = fy - cy;
            let dist_sq = dx * dx + dy * dy;
            if dist_sq > radius_sq {
                continue;
            }

            let mut angle = dy.atan2(dx) + std::f32::consts::FRAC_PI_2;
            if angle < 0.0 {
                angle += tau;
            }

            let mut color = boundaries[boundaries.len() - 1].1;
            for (limit, candidate) in &boundaries {
                if angle <= *limit {
                    color = *candidate;
                    break;
                }
            }
            blend_pixel(&mut rgba, x, y, color);
        }
    }

    if highlight {
        draw_circle(
            &mut rgba,
            (ICON_SIZE / 2) as i32,
            (ICON_SIZE / 2) as i32,
            (ICON_SIZE as i32 / 2) - 3,
            [255, 255, 255, 18],
        );
    }

    Image::new_owned(rgba, ICON_SIZE, ICON_SIZE)
}

fn draw_check_mark(rgba: &mut [u8], color: [u8; 4]) {
    let size = ICON_SIZE as f32;
    let stroke_radius = 2;

    let start = (size * 0.31, size * 0.53);
    let mid = (size * 0.44, size * 0.66);
    let end = (size * 0.71, size * 0.36);

    draw_thick_line(rgba, start, mid, stroke_radius, color);
    draw_thick_line(rgba, mid, end, stroke_radius, color);
}

fn draw_thick_line(
    rgba: &mut [u8],
    start: (f32, f32),
    end: (f32, f32),
    radius: i32,
    color: [u8; 4],
) {
    if radius <= 0 {
        return;
    }

    let dx = end.0 - start.0;
    let dy = end.1 - start.1;
    let dist = (dx * dx + dy * dy).sqrt();
    let steps = dist.ceil().max(1.0) as i32;

    for i in 0..=steps {
        let t = i as f32 / steps as f32;
        let x = start.0 + dx * t;
        let y = start.1 + dy * t;
        draw_circle(rgba, x.round() as i32, y.round() as i32, radius, color);
    }
}

fn draw_circle(rgba: &mut [u8], cx: i32, cy: i32, radius: i32, color: [u8; 4]) {
    if radius <= 0 {
        return;
    }
    let radius_sq = radius * radius;
    for y in (cy - radius)..=(cy + radius) {
        for x in (cx - radius)..=(cx + radius) {
            let dx = x - cx;
            let dy = y - cy;
            if (dx * dx) + (dy * dy) <= radius_sq {
                blend_pixel(rgba, x, y, color);
            }
        }
    }
}

fn blend_pixel(rgba: &mut [u8], x: i32, y: i32, color: [u8; 4]) {
    if x < 0 || y < 0 || x >= ICON_SIZE as i32 || y >= ICON_SIZE as i32 {
        return;
    }
    let idx = ((y as usize * ICON_SIZE as usize + x as usize) * 4) as usize;
    let src_a = color[3] as u16;
    if src_a == 0 {
        return;
    }
    if src_a == 255 {
        rgba[idx] = color[0];
        rgba[idx + 1] = color[1];
        rgba[idx + 2] = color[2];
        rgba[idx + 3] = color[3];
        return;
    }

    let dst_r = rgba[idx] as u16;
    let dst_g = rgba[idx + 1] as u16;
    let dst_b = rgba[idx + 2] as u16;
    let dst_a = rgba[idx + 3] as u16;
    let inv_a = 255 - src_a;

    rgba[idx] = ((color[0] as u16 * src_a + dst_r * inv_a) / 255) as u8;
    rgba[idx + 1] = ((color[1] as u16 * src_a + dst_g * inv_a) / 255) as u8;
    rgba[idx + 2] = ((color[2] as u16 * src_a + dst_b * inv_a) / 255) as u8;
    rgba[idx + 3] = (src_a + (dst_a * inv_a) / 255) as u8;
}
