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
    pub blocked_count: u32,
    pub completed_count: u32,
}

#[derive(Clone, Copy)]
enum AggregateStatus {
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

    let tray = TrayIconBuilder::with_id(TRAY_ID)
        .icon(render_badge_icon(0, AggregateStatus::Done.color()))
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
        let _ = tray.set_title(Some("0"));
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
    let icon = render_badge_icon(snapshot.unresolved_count.min(99), status.color());
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
    if snapshot.in_progress_count > 0 {
        AggregateStatus::InProgress
    } else if snapshot.queued_count > 0 {
        AggregateStatus::Queued
    } else if snapshot.todo_count > 0 {
        AggregateStatus::Todo
    } else if snapshot.need_info_count > 0 {
        AggregateStatus::NeedInfo
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
        "Maple · {} · 待处理 {}\n进行中 {} · 队列中 {} · 待办 {} · 需信息 {} · 已阻塞 {} · 已完成 {}",
        status.label(),
        snapshot.unresolved_count,
        snapshot.in_progress_count,
        snapshot.queued_count,
        snapshot.todo_count,
        snapshot.need_info_count,
        snapshot.blocked_count,
        snapshot.completed_count
    )
}

fn format_badge_count(count: u32) -> String {
    if count > 99 {
        "99+".to_string()
    } else {
        count.to_string()
    }
}

fn render_badge_icon(count: u32, color: [u8; 4]) -> Image<'static> {
    let mut rgba = vec![0u8; (ICON_SIZE * ICON_SIZE * 4) as usize];

    draw_circle(
        &mut rgba,
        (ICON_SIZE / 2) as i32,
        (ICON_SIZE / 2) as i32,
        (ICON_SIZE as i32 / 2) - 1,
        color,
    );
    draw_circle(
        &mut rgba,
        (ICON_SIZE / 2) as i32,
        (ICON_SIZE / 2) as i32,
        (ICON_SIZE as i32 / 2) - 3,
        [255, 255, 255, 18],
    );

    draw_count_label(&mut rgba, count.min(99));
    Image::new_owned(rgba, ICON_SIZE, ICON_SIZE)
}

fn draw_count_label(rgba: &mut [u8], count: u32) {
    let digits: Vec<u32> = count
        .to_string()
        .chars()
        .filter_map(|ch| ch.to_digit(10))
        .collect();
    if digits.is_empty() {
        return;
    }

    let two_digits = digits.len() >= 2;
    let digit_w = if two_digits { 9 } else { 12 };
    let digit_h = if two_digits { 16 } else { 19 };
    let gap = if two_digits { 2 } else { 0 };
    let total_w = (digit_w * digits.len() as i32) + (gap * (digits.len() as i32 - 1));
    let start_x = ((ICON_SIZE as i32 - total_w) / 2).max(0);
    let start_y = ((ICON_SIZE as i32 - digit_h) / 2).max(0);

    for (index, value) in digits.into_iter().enumerate() {
        let x = start_x + index as i32 * (digit_w + gap);
        draw_digit(
            rgba,
            x + 1,
            start_y + 1,
            digit_w,
            digit_h,
            value as u8,
            [0, 0, 0, 110],
        );
        draw_digit(
            rgba,
            x,
            start_y,
            digit_w,
            digit_h,
            value as u8,
            [255, 255, 255, 255],
        );
    }
}

fn draw_digit(rgba: &mut [u8], x: i32, y: i32, width: i32, height: i32, value: u8, color: [u8; 4]) {
    if width <= 0 || height <= 0 {
        return;
    }
    let thickness = if width >= 11 { 3 } else { 2 };
    let mid_y = y + (height / 2);
    let top_h = thickness;
    let vert_h = (height / 2) - thickness;
    let bottom_h = height - (height / 2) - thickness;

    let mut segments: [(i32, i32, i32, i32); 7] = [(0, 0, 0, 0); 7];
    segments[0] = (x + thickness, y, width - (thickness * 2), top_h);
    segments[1] = (x, y + thickness, thickness, vert_h);
    segments[2] = (x + width - thickness, y + thickness, thickness, vert_h);
    segments[3] = (
        x + thickness,
        mid_y - (thickness / 2),
        width - (thickness * 2),
        thickness,
    );
    segments[4] = (x, mid_y + (thickness / 2), thickness, bottom_h);
    segments[5] = (
        x + width - thickness,
        mid_y + (thickness / 2),
        thickness,
        bottom_h,
    );
    segments[6] = (
        x + thickness,
        y + height - thickness,
        width - (thickness * 2),
        thickness,
    );

    for (segment_index, enabled) in digit_segments(value).iter().enumerate() {
        if !enabled {
            continue;
        }
        let (sx, sy, sw, sh) = segments[segment_index];
        fill_rect(rgba, sx, sy, sw, sh, color);
    }
}

fn digit_segments(value: u8) -> [bool; 7] {
    match value {
        0 => [true, true, true, false, true, true, true],
        1 => [false, false, true, false, false, true, false],
        2 => [true, false, true, true, true, false, true],
        3 => [true, false, true, true, false, true, true],
        4 => [false, true, true, true, false, true, false],
        5 => [true, true, false, true, false, true, true],
        6 => [true, true, false, true, true, true, true],
        7 => [true, false, true, false, false, true, false],
        8 => [true, true, true, true, true, true, true],
        9 => [true, true, true, true, false, true, true],
        _ => [false; 7],
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

fn fill_rect(rgba: &mut [u8], x: i32, y: i32, width: i32, height: i32, color: [u8; 4]) {
    if width <= 0 || height <= 0 {
        return;
    }
    for py in y..(y + height) {
        for px in x..(x + width) {
            blend_pixel(rgba, px, py, color);
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
