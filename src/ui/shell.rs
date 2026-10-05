use crate::format;
use crate::state::App;
use crate::theme::{space, Theme};
use crate::ui::common::{self, Toast, ToastKind};
use crate::ui::detail::{self, DetailView};
use crate::ui::editor::{self, EditorView};
use crate::ui::library;
use crate::ui::net::{self, Inbox};
use crate::ui::settings;
use crate::ui::sidebar::{self, Sidebar};
use crate::ui::storage;

/// How often a long-running session reminds you it is still going.
const SESSION_NUDGE: std::time::Duration = std::time::Duration::from_secs(300);

/// The eframe application. Owns all view state; the drawing code lives in the
/// per-screen modules.
pub struct OrbitApp {
    pub app: App,
    sidebar: Sidebar,
    /// Which page the central panel shows.
    view: sidebar::View,
    detail: Option<DetailView>,
    editor: Option<EditorView>,
    storage: storage::StorageView,
    /// Set when the library or folder list changed and the storage page should
    /// re-read sizes the next time it is shown.
    storage_dirty: bool,
    /// Newest `updated_at` seen, used to notice library edits cheaply.
    storage_stamp: i64,
    toast: Option<Toast>,
    inbox: Inbox,
    /// Set when something changed and the window should redraw immediately.
    needs_repaint: bool,
    last_nudge: Option<std::time::Instant>,
    /// IGDB search results waiting to be handed to the editor.
    pending_search: Vec<crate::models::Game>,
    pending_search_error: Option<String>,
    /// The query those results answer, so a reply for an earlier search is
    /// dropped instead of shown.
    pending_search_query: String,
    /// Which editor id the pending results belong to.
    pending_search_target: i64,
}

impl OrbitApp {
    pub fn new(app: App, inbox: Inbox) -> Self {
        Self {
            app,
            sidebar: Sidebar::default(),
            view: sidebar::View::Library,
            detail: None,
            editor: None,
            storage: storage::StorageView::default(),
            storage_dirty: true,
            storage_stamp: 0,
            toast: None,
            inbox,
            needs_repaint: false,
            last_nudge: None,
            pending_search: Vec::new(),
            pending_search_error: None,
            pending_search_query: String::new(),
            pending_search_target: -1,
        }
    }

    /// Open the editor for a game id, or a blank one for 0.
    fn open_editor(&mut self, game_id: i64) {
        self.editor = Some(match self.app.game_by_id(game_id) {
            Some(g) => EditorView::for_existing(g),
            None => EditorView::new(),
        });
        self.view = sidebar::View::Editor;
        self.detail = None;
    }

    /// Close whatever sub-view is open and return to the sidebar's page, so
    /// Escape from the editor does not jump away from Sessions or Statistics.
    fn close_subview(&mut self) {
        self.editor = None;
        self.detail = None;
        self.view = self.sidebar.view();
    }

    /// Close only the editor. The sidebar has already changed the destination,
    /// so the current view is left alone.
    fn close_editor(&mut self) {
        self.editor = None;
    }

    /// Move a pending IGDB result into whichever editor asked for it. The
    /// editor must still be on screen, on the same game, and waiting for this
    /// exact query.
    fn deliver_pending_search(&mut self) {
        if self.pending_search_target == -1 || self.view != sidebar::View::Editor {
            return;
        }
        let target = self.pending_search_target;
        let query = self.pending_search_query.clone();
        let claimed = self
            .editor
            .as_ref()
            .is_some_and(|e| e.id() == target && e.claims(editor::PendingKind::Search, &query));
        if !claimed {
            // A stale reply: drop it so the spinner state is not clobbered.
            self.pending_search_target = -1;
            self.pending_search.clear();
            self.pending_search_error = None;
            self.pending_search_query.clear();
            return;
        }

        let results = std::mem::take(&mut self.pending_search);
        let error = self.pending_search_error.take();
        self.pending_search_target = -1;
        self.pending_search_query.clear();
        self.needs_repaint = true;
        if let Some(editor) = self.editor.as_mut() {
            editor.on_search_results(results, error);
        }
    }

    /// Route one finished HLTB result to the editor draft that asked for it,
    /// falling back to the saved library entry.
    fn route_hltb(&mut self, res: crate::ui::net::jobs::HltbResult) {
        let title = res.title.clone();
        let claimed = self
            .editor
            .as_ref()
            .is_some_and(|e| e.claims(editor::PendingKind::Hltb, &title));
        if claimed {
            if let Some(editor) = self.editor.as_mut() {
                editor.on_hltb_done(res.data);
            }
            if let Some(err) = res.error {
                self.app.last_error = Some(format!("HowLongToBeat: {err}"));
            }
            self.needs_repaint = true;
            return;
        }
        if net::apply_hltb(&mut self.app, res) {
            self.needs_repaint = true;
        }
        if let Some(view) = self.detail.as_mut() {
            view.clear_busy();
        }
    }

    /// Route one finished IGDB fetch the same way.
    fn route_igdb_fetch(&mut self, res: crate::ui::net::jobs::IgdbFetch) {
        let title = res.title.clone();
        let claimed = self
            .editor
            .as_ref()
            .is_some_and(|e| e.claims(editor::PendingKind::Fetch, &title));
        if claimed {
            if let Some(editor) = self.editor.as_mut() {
                editor.on_igdb_done(res.meta.as_ref());
            }
            if let Some(err) = res.error {
                self.app.last_error = Some(format!("IGDB: {err}"));
            }
            self.needs_repaint = true;
            return;
        }
        if net::apply_igdb_fetch(&mut self.app, res) {
            self.needs_repaint = true;
        }
    }

    /// Collect finished background work and apply it to the library or the
    /// open editor draft.
    fn drain_inbox(&mut self) {
        for res in net::take_hltb(&self.inbox) {
            self.route_hltb(res);
        }
        for res in net::take_igdb_fetch(&self.inbox) {
            self.route_igdb_fetch(res);
        }
        for res in net::take_igdb(&self.inbox) {
            self.pending_search = res.games;
            self.pending_search_error = res.error;
            self.pending_search_query = res.query;
            self.pending_search_target = self.editor.as_ref().map_or(0, EditorView::id);
        }
        self.deliver_pending_search();
    }

    /// Nudge the user if a session has run a long time.
    fn maybe_nudge(&mut self) {
        let limit_h = self.app.settings.session_limit_hours;
        if limit_h <= 0.0 {
            return;
        }
        let Some(active) = self.app.active.as_ref() else {
            self.last_nudge = None;
            return;
        };
        let limit_secs = (limit_h * 3600.0) as u64;
        if (active.elapsed_secs() as u64) < limit_secs {
            return;
        }
        let due = match self.last_nudge {
            None => true,
            Some(t) => t.elapsed() >= SESSION_NUDGE,
        };
        if due {
            self.last_nudge = Some(std::time::Instant::now());
            self.toast = Some(Toast {
                text: format!(
                    "You have been playing {} for {}.",
                    active.game_name,
                    crate::format::duration(active.elapsed_secs())
                ),
                kind: ToastKind::Info,
                ttl: std::time::Instant::now() + common::TOAST_TTL,
            });
        }
    }

    /// Turn queued outcomes and errors into a toast.
    fn pick_toast(&mut self) {
        if let Some(outcome) = library::take_outcome(&mut self.app) {
            self.toast = Some(common::outcome_toast(outcome));
            return;
        }
        if let Some(err) = self.app.last_error.take() {
            self.toast = Some(Toast {
                text: err,
                kind: ToastKind::Error,
                ttl: std::time::Instant::now() + common::TOAST_TTL,
            });
            return;
        }
        if let Some(msg) = self.app.startup_message.take() {
            self.toast = Some(Toast {
                text: msg,
                kind: ToastKind::Info,
                ttl: std::time::Instant::now() + std::time::Duration::from_secs(10),
            });
        }
    }

    /// Act on whatever the sub-views asked for.
    fn handle_actions(&mut self) {
        match detail::take_action() {
            Some(detail::Action::Close) => self.close_subview(),
            Some(detail::Action::Edit(id)) => self.open_editor(id),
            Some(detail::Action::LibraryChanged) | None => self.needs_repaint = true,
        }
        if library::take_open_editor().is_some() {
            self.open_editor(0);
        }
        if let Some(id) = library::take_open_game() {
            self.detail = Some(DetailView::new(id));
            self.editor = None;
        }
    }
}

impl eframe::App for OrbitApp {
    fn update(&mut self, ctx: &egui::Context, _frame: &mut eframe::Frame) {
        // 1. Watch the launched process so a session closes when the game quits.
        if self.app.poll_active() {
            self.needs_repaint = true;
        }

        // 1b. A copy in progress reports progress until it finishes, which is
        // when the game's folder on disk changes.
        if self.app.move_job.is_some() {
            if self.app.poll_move() {
                self.needs_repaint = true;
            }
            if self.app.move_job.is_some() {
                ctx.request_repaint_after(std::time::Duration::from_millis(250));
            }
        }

        // 1c. Folder sizes come from disk, so rescan when a game's folder may
        // have changed. Cheap enough to check every frame.
        let newest = self
            .app
            .games
            .iter()
            .map(|(g, _)| g.updated_at)
            .max()
            .unwrap_or(0);
        if newest != self.storage_stamp {
            self.storage_stamp = newest;
            self.storage_dirty = true;
        }

        // 2. Pick up background results and queued user intent.
        self.drain_inbox();
        // A `Ctrl+1..5` press is a navigation request, handled like a click.
        if self.sidebar.nav_from_shortcut(ctx).is_some() {
            // Any destination change dismisses the sub-views, the same as a
            // click on the sidebar.
            self.close_editor();
            self.detail = None;
            self.view = self.sidebar.view();
        }
        self.handle_actions();
        if ctx.input(|i| i.key_pressed(egui::Key::Escape)) {
            self.close_subview();
        }
        if self.editor.is_none() {
            let new_game = ctx.input(|i| i.modifiers.ctrl && i.key_pressed(egui::Key::N));
            if new_game || ctx.input(|i| i.key_pressed(egui::Key::F2)) {
                self.open_editor(0);
            }
        }
        self.maybe_nudge();

        // 3. Repaint while a timer is running so the clock advances.
        if self.app.active.is_some() {
            ctx.request_repaint_after(std::time::Duration::from_millis(500));
        }
        if std::mem::take(&mut self.needs_repaint) {
            ctx.request_repaint();
        }

        // 4. Apply theme and zoom before anything draws.
        self.app.apply_theme(ctx);
        let scale = self.app.settings.ui_scale as f32;
        if (ctx.zoom_factor() - scale).abs() > 0.001 {
            ctx.set_zoom_factor(scale);
        }
        let theme = self.app.theme;

        // 5. Draw. A sidebar click always wins, so the editor can be dismissed
        // with the mouse. Without a click an open editor keeps the centre panel.
        self.sidebar.show(ctx, &mut self.app);
        if self.sidebar.take_nav_click().is_some() {
            // Any destination click dismisses the sub-views, including the
            // detail page when the user returns to the grid.
            self.close_editor();
            self.detail = None;
            self.view = self.sidebar.view();
        } else if self.editor.is_some() {
            self.view = sidebar::View::Editor;
        }

        // The top bar is a thin app bar that only appears while a game is
        // running, so the page keeps the full height the rest of the time.
        if self.app.active.is_some() {
            egui::TopBottomPanel::top("topbar")
                .exact_height(56.0)
                .frame(
                    egui::Frame::new()
                        .fill(theme.playing_tint)
                        .stroke(egui::Stroke::new(1.0_f32, theme.border))
                        .inner_margin(egui::Margin::symmetric(space::LG as i8, space::SM as i8)),
                )
                .show(ctx, |ui| {
                    ui.horizontal_centered(|ui| {
                        common::active_session_bar(&theme, ui, &mut self.app);
                    });
                });
        }

        egui::CentralPanel::default()
            .frame(egui::Frame::new().fill(theme.bg).inner_margin(0.0))
            .show(ctx, |ui| match self.view {
                sidebar::View::Library => self.library_page(ui, theme),
                sidebar::View::Sessions => self.sessions_page(ui, theme),
                sidebar::View::Storage => self.storage_page(ui, theme),
                sidebar::View::Stats => self.stats_page(ui, theme),
                sidebar::View::Settings => settings::show(ui, &mut self.app, theme),
                sidebar::View::Editor => self.editor_page(ui, theme),
            });

        self.pick_toast();
        common::show_toast(&theme, ctx, &mut self.toast);

        // 6. Persist settings changed during this frame.
        self.app.flush_settings();

        ctx.send_viewport_cmd(egui::ViewportCommand::Title(
            "Orbit \u{b7} game launcher".into(),
        ));
    }
}

impl OrbitApp {
    fn library_page(&mut self, ui: &mut egui::Ui, theme: Theme) {
        // The detail view replaces the grid until dismissed.
        if self.detail.is_some() {
            if let Some(view) = self.detail.as_mut() {
                detail::show(ui, &mut self.app, theme, view);
                return;
            }
        }

        library::top_bar(ui, &mut self.app, theme);
        ui.add_space(4.0);
        library::grid(ui, &mut self.app, theme, &mut self.needs_repaint);
    }

    fn storage_page(&mut self, ui: &mut egui::Ui, theme: Theme) {
        // Folder sizes come from disk, so they are read on entry rather than
        // every frame.
        if self.storage_dirty {
            self.app.refresh_storage();
            self.storage_dirty = false;
        }
        let open = storage::show(
            ui,
            &mut self.app,
            theme,
            &mut self.storage,
            &mut self.needs_repaint,
        );
        if let Some(id) = open {
            self.detail = Some(DetailView::new(id));
            self.editor = None;
        }
    }

    fn sessions_page(&mut self, ui: &mut egui::Ui, theme: Theme) {
        let count = self
            .app
            .lib
            .list_sessions(None)
            .map(|s| s.len())
            .unwrap_or(0);
        common::page_header(
            &theme,
            ui,
            "Sessions",
            Some(&format!("{count} logged")),
            |ui| {
                if common::secondary_button(&theme, ui, "Refresh").clicked() {
                    self.app.reload();
                    self.needs_repaint = true;
                }
            },
        );
        ui.add_space(space::SM);
        library::sessions_page(ui, &mut self.app, theme);
    }

    fn stats_page(&mut self, ui: &mut egui::Ui, theme: Theme) {
        let total = format::duration(self.app.stats.total_secs);
        common::page_header(&theme, ui, "Statistics", Some(&total), |ui| {
            if common::secondary_button(&theme, ui, "Refresh").clicked() {
                self.app.reload();
                self.needs_repaint = true;
            }
        });
        ui.add_space(space::SM);
        library::stats_page(ui, &mut self.app, theme);
    }

    fn editor_page(&mut self, ui: &mut egui::Ui, theme: Theme) {
        let action = match self.editor.as_mut() {
            Some(view) => editor::show(ui, &mut self.app, theme, view),
            None => editor::Action::Close,
        };
        if action == editor::Action::Close {
            self.close_subview();
        }
    }
}
