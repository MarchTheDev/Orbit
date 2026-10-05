use std::path::PathBuf;

use egui::{Align, Layout, RichText};

use crate::format;
use crate::models::{Game, LaunchTarget};
use crate::state::App;
use crate::theme::{radius, space, type_size, Theme};
use crate::ui::common;
use crate::ui::images;

/// Which launch tab is open in the editor.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Default)]
enum LaunchTab {
    #[default]
    None,
    Executable,
    Steam,
    Emulator,
}

/// What the editor wants the shell to do once the frame finishes.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Action {
    /// Nothing; keep the editor open.
    None,
    /// Save succeeded or the user cancelled, so leave the editor.
    Close,
}

/// The background request an editor is waiting on. The shell uses this to route
/// a result to the draft that asked for it instead of the saved library entry.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum PendingKind {
    Search,
    Fetch,
    Hltb,
}

/// Add/edit game form. `game_id == 0` means a new game.
pub struct EditorView {
    game_id: i64,
    draft: Game,
    name_edit: String,
    dev_edit: String,
    pub_edit: String,
    genres_edit: String,
    platforms_edit: String,
    desc_edit: String,
    notes_edit: String,
    exe_path: String,
    exe_args: String,
    exe_dir: String,
    steam_id: String,
    emu_path: String,
    emu_args: String,
    rom_path: String,
    tab: LaunchTab,
    rating: i32,
    manual_total_hours: f64,
    override_total: bool,
    hltb_pending: bool,
    igdb_pending: bool,
    search_query: String,
    search_results: Vec<Game>,
    search_error: Option<String>,
    busy: bool,
}

impl EditorView {
    /// Build an editor for a new game.
    pub fn new() -> Self {
        Self::for_game(Game::new(""))
    }

    /// Build an editor seeded from an existing library entry.
    pub fn for_existing(game: &Game) -> Self {
        Self::for_game(game.clone())
    }

    fn for_game(draft: Game) -> Self {
        let (tab, exe_path, exe_args, exe_dir, steam_id, emu_path, emu_args, rom_path) =
            match &draft.launch {
                LaunchTarget::None => (
                    LaunchTab::None,
                    String::new(),
                    String::new(),
                    String::new(),
                    String::new(),
                    String::new(),
                    String::new(),
                    String::new(),
                ),
                LaunchTarget::Executable {
                    path,
                    args,
                    working_dir,
                } => (
                    LaunchTab::Executable,
                    path.to_string_lossy().to_string(),
                    args.clone(),
                    working_dir
                        .as_ref()
                        .map(|p| p.to_string_lossy().to_string())
                        .unwrap_or_default(),
                    String::new(),
                    String::new(),
                    String::new(),
                    String::new(),
                ),
                LaunchTarget::Steam { app_id } => (
                    LaunchTab::Steam,
                    String::new(),
                    String::new(),
                    String::new(),
                    app_id.to_string(),
                    String::new(),
                    String::new(),
                    String::new(),
                ),
                LaunchTarget::Emulator {
                    emulator_path,
                    args_template,
                    rom_path,
                } => (
                    LaunchTab::Emulator,
                    String::new(),
                    String::new(),
                    String::new(),
                    String::new(),
                    emulator_path.to_string_lossy().to_string(),
                    args_template.clone(),
                    rom_path.to_string_lossy().to_string(),
                ),
            };

        let override_total = draft.manual_playtime_secs > 0;
        let manual_total_hours = draft.manual_playtime_secs as f64 / 3600.0;

        Self {
            game_id: draft.id,
            name_edit: draft.name.clone(),
            dev_edit: draft.developer.clone(),
            pub_edit: draft.publisher.clone(),
            genres_edit: draft.genres.join(", "),
            platforms_edit: draft.platforms.join(", "),
            desc_edit: draft.description.clone(),
            notes_edit: draft.notes.clone(),
            exe_path,
            exe_args,
            exe_dir,
            steam_id,
            emu_path,
            emu_args,
            rom_path,
            tab,
            rating: draft.rating,
            override_total,
            manual_total_hours,
            hltb_pending: false,
            igdb_pending: false,
            search_query: String::new(),
            search_results: Vec::new(),
            search_error: None,
            busy: false,
            draft,
        }
    }
}

impl EditorView {
    /// The game being edited, or 0 for a new one.
    pub fn id(&self) -> i64 {
        self.game_id
    }

    /// The title the editor's most recent request used, for a given kind.
    pub fn request_title(&self, kind: PendingKind) -> &str {
        match kind {
            PendingKind::Search => self.search_query.trim(),
            PendingKind::Fetch | PendingKind::Hltb => self.name_edit.trim(),
        }
    }

    /// Does this result belong to the request the editor is waiting on? The
    /// title must still match, so a late reply for an earlier title is dropped.
    pub fn claims(&self, kind: PendingKind, title: &str) -> bool {
        self.is_pending(kind) && self.request_title(kind) == title
    }

    fn is_pending(&self, kind: PendingKind) -> bool {
        match kind {
            PendingKind::Search => self.busy,
            PendingKind::Fetch => self.igdb_pending,
            PendingKind::Hltb => self.hltb_pending,
        }
    }

    /// Hand a completed IGDB search to the editor.
    pub fn on_search_results(&mut self, games: Vec<Game>, error: Option<String>) {
        self.search_results = games;
        self.search_error = error;
        self.busy = false;
    }

    /// A background HLTB lookup finished, whether or not it found anything.
    pub fn on_hltb_done(&mut self, data: Option<crate::models::HltbData>) {
        self.hltb_pending = false;
        if let Some(data) = data {
            self.draft.hltb = Some(data);
        }
    }

    /// A background IGDB fetch finished. `meta` is applied to the draft so
    /// unsaved games benefit too.
    pub fn on_igdb_done(&mut self, meta: Option<&Game>) {
        self.igdb_pending = false;
        if let Some(meta) = meta {
            merge_meta(&mut self.draft, meta);
            self.name_edit = meta.name.clone();
        }
    }
}

pub fn show(ui: &mut egui::Ui, app: &mut App, theme: Theme, view: &mut EditorView) -> Action {
    let mut action = Action::None;

    // `Ctrl+S` saves from anywhere in the form, like every other editor.
    let ctrl_s = ui.input(|i| i.modifiers.ctrl && i.key_pressed(egui::Key::S));

    egui::ScrollArea::vertical()
        .auto_shrink([false, false])
        .show(ui, |ui| {
            ui.set_width(ui.available_width());

            if header(ui, app, theme, view) || (ctrl_s && save(ui, app, theme, view)) {
                action = Action::Close;
            }

            ui.add_space(space::LG);
            if let Some(error) = app.last_error.clone() {
                problem(ui, theme, &error);
                ui.add_space(space::LG);
            }

            egui::Grid::new("editor_grid")
                .num_columns(2)
                .spacing([space::XL, space::LG])
                .show(ui, |ui| {
                    basics(ui, theme, view);
                    metadata(ui, app, theme, view);
                });

            ui.add_space(space::LG);
            launch_section(ui, theme, view);

            ui.add_space(space::LG);
            install_folder_section(ui, app, theme, view);

            ui.add_space(space::LG);
            egui::Grid::new("editor_grid_bottom")
                .num_columns(2)
                .spacing([space::XL, space::LG])
                .show(ui, |ui| {
                    playtime_section(ui, theme, view);
                    notes_section(ui, theme, view);
                });

            ui.add_space(space::XL);
            if footer(ui, app, theme, view) {
                action = Action::Close;
            }
            ui.add_space(space::XL);
        });

    action
}

/// The editor's own header. Save and Cancel live here as well as at the bottom
/// so the form is submittable without scrolling past six cards.
fn header(ui: &mut egui::Ui, app: &mut App, theme: Theme, view: &mut EditorView) -> bool {
    let (title, subtitle) = if view.game_id == 0 {
        (
            "Add a game".to_string(),
            "Orbit will track it from here.".to_string(),
        )
    } else {
        (
            if view.name_edit.trim().is_empty() {
                "Edit game".to_string()
            } else {
                view.name_edit.trim().to_string()
            },
            format!("Editing entry #{}  \u{b7}  Esc to cancel", view.game_id),
        )
    };

    let mut close = false;
    common::page_header(&theme, ui, &title, Some(&subtitle), |ui| {
        // `right_to_left` places the first widget at the right edge.
        if common::primary_button(&theme, ui, save_label(view)).clicked() {
            close = save(ui, app, theme, view);
        }
        if common::secondary_button(&theme, ui, "Cancel").clicked() {
            close = true;
        }
        common::key_hint(&theme, ui, "Ctrl+S");
    });
    close
}

fn footer(ui: &mut egui::Ui, app: &mut App, theme: Theme, view: &mut EditorView) -> bool {
    let mut close = false;
    ui.with_layout(Layout::right_to_left(Align::Min), |ui| {
        if common::primary_button(&theme, ui, save_label(view)).clicked() {
            close = save(ui, app, theme, view);
        }
        if common::secondary_button(&theme, ui, "Cancel").clicked() {
            close = true;
        }
        common::key_hint(&theme, ui, "Ctrl+S  save");
    });
    close
}

fn save_label(view: &EditorView) -> &'static str {
    if view.game_id == 0 {
        "Add to library"
    } else {
        "Save changes"
    }
}

/// An inline validation message. Errors from a failed save stay on screen until
/// the next successful save, instead of flashing and disappearing.
fn problem(ui: &mut egui::Ui, theme: Theme, message: &str) {
    egui::Frame::new()
        .fill(theme.danger_soft)
        .stroke(egui::Stroke::new(1.0_f32, theme.danger))
        .corner_radius(radius::MD)
        .inner_margin(egui::Margin::symmetric(space::LG as i8, space::SM as i8))
        .show(ui, |ui| {
            ui.horizontal(|ui| {
                ui.label(
                    RichText::new("\u{26A0}")
                        .size(type_size::BODY)
                        .color(theme.danger),
                );
                ui.label(
                    RichText::new(message)
                        .size(type_size::BODY)
                        .color(theme.text),
                );
            });
        });
}

fn basics(ui: &mut egui::Ui, theme: Theme, view: &mut EditorView) {
    common::card(&theme, ui, |ui| {
        ui.set_width(ui.available_width());
        common::section_header(
            &theme,
            ui,
            "Details",
            Some("what you type here is yours to keep"),
        );
        ui.add_space(space::MD);

        common::setting_row(&theme, ui, "Title", None, |ui| {
            ui.add(
                egui::TextEdit::singleline(&mut view.name_edit)
                    .desired_width(ui.available_width())
                    .hint_text("Game name")
                    .text_color(theme.text),
            );
        });
        common::setting_row(&theme, ui, "Developer", None, |ui| {
            ui.add(
                egui::TextEdit::singleline(&mut view.dev_edit)
                    .desired_width(ui.available_width())
                    .text_color(theme.text),
            );
        });
        common::setting_row(&theme, ui, "Publisher", None, |ui| {
            ui.add(
                egui::TextEdit::singleline(&mut view.pub_edit)
                    .desired_width(ui.available_width())
                    .text_color(theme.text),
            );
        });
        common::setting_row(&theme, ui, "Genres", Some("comma separated"), |ui| {
            ui.add(
                egui::TextEdit::singleline(&mut view.genres_edit)
                    .desired_width(ui.available_width())
                    .text_color(theme.text),
            );
        });
        common::setting_row(&theme, ui, "Platforms", Some("comma separated"), |ui| {
            ui.add(
                egui::TextEdit::singleline(&mut view.platforms_edit)
                    .desired_width(ui.available_width())
                    .text_color(theme.text),
            );
        });

        ui.add_space(space::MD);
        common::section_rule(&theme, ui, "Cover art");
        ui.add_space(space::SM);
        cover(ui, theme, view);

        ui.add_space(space::MD);
        common::section_rule(&theme, ui, "Your rating");
        ui.add_space(space::SM);
        common::star_rating(&theme, ui, &mut view.rating, true);
    });
}

fn cover(ui: &mut egui::Ui, theme: Theme, view: &mut EditorView) {
    ui.horizontal(|ui| {
        let preview = view
            .draft
            .cover_path
            .clone()
            .filter(|p| p.exists())
            .and_then(|p| images::cover_texture(ui.ctx(), &p));

        let (rect, _) = ui.allocate_exact_size(egui::vec2(72.0, 100.0), egui::Sense::hover());
        if let Some(tex) = preview {
            images::paint_into(ui, tex, rect);
            ui.painter().rect_stroke(
                rect,
                radius::LG,
                egui::Stroke::new(1.0_f32, theme.border),
                egui::StrokeKind::Inside,
            );
        } else {
            ui.painter()
                .rect_filled(rect, radius::LG, theme.surface_alt);
            ui.painter().rect_stroke(
                rect,
                radius::LG,
                egui::Stroke::new(1.0_f32, theme.border),
                egui::StrokeKind::Inside,
            );
            let galley = ui.painter().layout_no_wrap(
                "none".to_string(),
                egui::FontId::proportional(type_size::CAPTION),
                theme.text_faint,
            );
            ui.painter().galley(
                rect.center() - galley.size() / 2.0,
                galley,
                theme.text_faint,
            );
        }

        ui.vertical(|ui| {
            let path_text = view
                .draft
                .cover_path
                .as_ref()
                .map(|p| {
                    p.file_name()
                        .unwrap_or(p.as_os_str())
                        .to_string_lossy()
                        .to_string()
                })
                .unwrap_or_else(|| "No cover selected".into());
            ui.label(RichText::new(path_text).size(type_size::SMALL).color(
                if view.draft.cover_path.is_some() {
                    theme.text
                } else {
                    theme.text_faint
                },
            ));
            ui.add_space(space::SM);
            ui.horizontal(|ui| {
                if common::secondary_button(&theme, ui, "Browse\u{2026}").clicked() {
                    if let Some(p) = rfd::FileDialog::new()
                        .add_filter("Images", &["png", "jpg", "jpeg", "webp", "bmp"])
                        .pick_file()
                    {
                        view.draft.cover_path = Some(p);
                    }
                }
                if view.draft.cover_path.is_some() && theme.subtle_button(ui, "Clear").clicked() {
                    view.draft.cover_path = None;
                }
            });
        });
    });
}

/// The IGDB panel: search, pick a result, or fill straight from the title.
fn metadata(ui: &mut egui::Ui, app: &mut App, theme: Theme, view: &mut EditorView) {
    common::card(&theme, ui, |ui| {
        ui.set_width(ui.available_width());
        common::section_header(
            &theme,
            ui,
            "Metadata",
            Some(if app.settings.igdb_ready() {
                "IGDB"
            } else {
                "IGDB  \u{b7}  needs credentials"
            }),
        );
        ui.add_space(space::MD);

        if !app.settings.igdb_ready() {
            note(
                ui,
                theme,
                "IGDB needs Twitch credentials. Add them in Settings to search and auto-fill.",
            );
        }

        if app.settings.igdb_ready() {
            ui.horizontal(|ui| {
                ui.label(
                    RichText::new("Search IGDB")
                        .size(type_size::BODY)
                        .color(theme.text),
                );
                let mut query = view.search_query.clone();
                common::search_field(
                    &theme,
                    ui,
                    &mut query,
                    "Type a title, then Search",
                    (ui.available_width() - 120.0).max(80.0),
                );
                if query != view.search_query {
                    view.search_query = query;
                }
            });
            ui.add_space(space::SM);

            ui.horizontal(|ui| {
                let can_search = !view.search_query.trim().is_empty() && !view.busy;
                let search = if can_search {
                    common::primary_button(
                        &theme,
                        ui,
                        if view.busy {
                            "Searching\u{2026}"
                        } else {
                            "Search"
                        },
                    )
                } else {
                    disabled_button(
                        theme,
                        ui,
                        if view.busy {
                            "Searching\u{2026}"
                        } else {
                            "Search"
                        },
                    )
                };
                if search.clicked() && can_search {
                    view.busy = true;
                    view.search_results.clear();
                    view.search_error = None;
                    let q = view.search_query.trim().to_string();
                    crate::ui::net::spawn_igdb_search(app, &q);
                }
                if common::secondary_button(
                    &theme,
                    ui,
                    if view.igdb_pending {
                        "Fetching\u{2026}"
                    } else {
                        "Fill from title"
                    },
                )
                .on_hover_text("Take the first IGDB match for the title above")
                .clicked()
                    && !view.igdb_pending
                {
                    let title = view.name_edit.trim().to_string();
                    if title.is_empty() {
                        view.search_error = Some("Enter a title first".into());
                    } else {
                        view.igdb_pending = true;
                        crate::ui::net::spawn_igdb_fetch(app, view.game_id, &title);
                    }
                }
            });

            if view.busy || view.igdb_pending {
                ui.add_space(space::SM);
                common::status_dot(&theme, ui, theme.accent, "talking to IGDB\u{2026}");
            }
            if let Some(err) = view.search_error.clone() {
                ui.add_space(space::SM);
                ui.label(
                    RichText::new(err)
                        .size(type_size::SMALL)
                        .color(theme.danger),
                );
            }

            if !view.search_results.is_empty() {
                ui.add_space(space::MD);
                common::section_rule(&theme, ui, "Matches");
                ui.add_space(space::SM);
                egui::ScrollArea::vertical()
                    .max_height(180.0)
                    .auto_shrink([false, false])
                    .show(ui, |ui| {
                        let results = view.search_results.clone();
                        for meta in results {
                            let chosen = meta.name == view.name_edit;
                            let (_, resp) = common::clickable_card(&theme, ui, chosen, |ui| {
                                ui.set_width(ui.available_width());
                                ui.label(
                                    RichText::new(&meta.name)
                                        .size(type_size::BODY)
                                        .strong()
                                        .color(theme.text),
                                );
                                let mut facts = Vec::new();
                                if let Some(d) =
                                    meta.release_date.as_ref().filter(|d| !d.is_empty())
                                {
                                    facts.push(d.clone());
                                }
                                if !meta.platforms.is_empty() {
                                    facts.push(meta.platforms.join(", "));
                                }
                                if !facts.is_empty() {
                                    ui.label(
                                        RichText::new(facts.join("  \u{b7}  "))
                                            .size(type_size::CAPTION)
                                            .color(theme.text_faint),
                                    );
                                }
                            });
                            if resp.clicked() {
                                merge_meta(&mut view.draft, &meta);
                                view.name_edit = meta.name.clone();
                                view.search_results.clear();
                                view.search_error = None;
                            }
                        }
                    });
            }
        }

        ui.add_space(space::MD);
        common::section_rule(&theme, ui, "Description");
        ui.add_space(space::SM);
        ui.add(
            egui::TextEdit::multiline(&mut view.desc_edit)
                .desired_rows(4)
                .desired_width(ui.available_width())
                .hint_text("Synced from IGDB, or write your own")
                .text_color(theme.text),
        );

        ui.add_space(space::MD);
        common::section_rule(&theme, ui, "Completion estimate");
        ui.add_space(space::SM);
        hltb(ui, app, theme, view);
    });
}

fn hltb(ui: &mut egui::Ui, app: &mut App, theme: Theme, view: &mut EditorView) {
    ui.horizontal(|ui| match view.draft.hltb {
        Some(h) => {
            ui.label(
                RichText::new(format!(
                    "main {}  \u{b7}  +side {}  \u{b7}  100% {}",
                    format::hours(h.main),
                    format::hours(h.main_plus),
                    format::hours(h.completionist)
                ))
                .size(type_size::SMALL)
                .color(theme.text),
            );
            ui.with_layout(Layout::right_to_left(Align::Center), |ui| {
                if theme.subtle_button(ui, "Clear").clicked() {
                    view.draft.hltb = None;
                }
                if common::secondary_button(
                    &theme,
                    ui,
                    if view.hltb_pending {
                        "Looking up\u{2026}"
                    } else {
                        "Look up"
                    },
                )
                .clicked()
                    && !view.hltb_pending
                {
                    view.hltb_pending = true;
                    crate::ui::net::jobs::spawn_hltb_lookup(app, view.game_id, &view.name_edit);
                }
            });
        }
        None => {
            ui.label(
                RichText::new("No estimate yet.")
                    .size(type_size::SMALL)
                    .color(theme.text_faint),
            );
            ui.with_layout(Layout::right_to_left(Align::Center), |ui| {
                if common::secondary_button(
                    &theme,
                    ui,
                    if view.hltb_pending {
                        "Looking up\u{2026}"
                    } else {
                        "Look up by title"
                    },
                )
                .on_hover_text("Search HowLongToBeat for the title above")
                .clicked()
                    && !view.hltb_pending
                {
                    view.hltb_pending = true;
                    crate::ui::net::jobs::spawn_hltb_lookup(app, view.game_id, &view.name_edit);
                }
            });
        }
    });
}

fn launch_section(ui: &mut egui::Ui, theme: Theme, view: &mut EditorView) {
    let launch_label = view.draft.launch.label();
    common::card(&theme, ui, |ui| {
        ui.set_width(ui.available_width());
        common::section_header(&theme, ui, "How to launch it", Some(&launch_label));
        ui.add_space(space::MD);

        if let Some(picked) = common::segmented(
            &theme,
            ui,
            "launch_tab",
            &[
                (LaunchTab::None, "Time only"),
                (LaunchTab::Executable, "PC executable"),
                (LaunchTab::Steam, "Steam"),
                (LaunchTab::Emulator, "Emulator / ROM"),
            ],
            view.tab,
        ) {
            view.tab = picked;
        }
        ui.add_space(space::MD);

        match view.tab {
            LaunchTab::None => {
                note(
                    ui,
                    theme,
                    "Orbit will only start and stop the timer. You launch the game yourself.",
                );
            }

            LaunchTab::Executable => {
                path_row(
                    ui,
                    theme,
                    &mut view.exe_path,
                    "Executable",
                    &["exe", "bat", "cmd"],
                );
                ui.add_space(space::SM);
                path_row(ui, theme, &mut view.exe_args, "Arguments", &[]);
                ui.add_space(space::SM);
                path_row(ui, theme, &mut view.exe_dir, "Working directory", &[]);

                if !view.exe_path.trim().is_empty() {
                    let path = PathBuf::from(view.exe_path.trim());
                    // A launch target that cannot run is worth pointing out
                    // here rather than the first time someone hits Play.
                    if !crate::launch::is_executable(&path) {
                        ui.add_space(space::SM);
                        note(
                            ui,
                            theme,
                            "That does not end in .exe, .bat, or .cmd, so Orbit may not be able to start it directly.",
                        );
                    } else if !path.exists() {
                        ui.add_space(space::SM);
                        common::status_dot(
                            &theme,
                            ui,
                            theme.text_faint,
                            "that file is not there right now",
                        );
                    }
                    if let Some(cover) = crate::launch::nearby_cover(
                        path.parent().unwrap_or(std::path::Path::new(".")),
                        &path.file_stem().unwrap_or_default().to_string_lossy(),
                    ) {
                        ui.add_space(space::SM);
                        ui.horizontal(|ui| {
                            common::status_dot(
                                &theme,
                                ui,
                                theme.success,
                                &format!("Found nearby art: {}", cover.display()),
                            );
                            if common::accent_button(&theme, ui, "Use as cover").clicked() {
                                view.draft.cover_path = Some(cover.clone());
                            }
                        });
                    }
                }
            }

            LaunchTab::Steam => {
                note(
                    ui,
                    theme,
                    "Enter the Steam App ID. Find it on the game's store page: the URL ends with /app/12345.",
                );
                ui.add_space(space::SM);
                ui.horizontal(|ui| {
                    ui.add(
                        egui::TextEdit::singleline(&mut view.steam_id)
                            .desired_width(140.0)
                            .hint_text("App ID")
                            .text_color(theme.text),
                    );
                    if common::secondary_button(&theme, ui, "Open store page").clicked() {
                        if let Some(id) = App::parse_steam_id(&view.steam_id) {
                            let _ =
                                opener::open(format!("https://store.steampowered.com/app/{id}"));
                        }
                    }
                });
            }

            LaunchTab::Emulator => {
                note(
                    ui,
                    theme,
                    "Point at your emulator and a ROM. {rom} in the arguments is replaced with the ROM path.",
                );
                ui.add_space(space::SM);
                path_row(
                    ui,
                    theme,
                    &mut view.emu_path,
                    "Emulator",
                    &["exe", "bat", "cmd"],
                );
                ui.add_space(space::SM);
                path_row(ui, theme, &mut view.emu_args, "Emulator arguments", &[]);
                ui.add_space(space::SM);
                path_row(ui, theme, &mut view.rom_path, "ROM file", &[]);
            }
        }
    });
}

/// The game's install folder, which is what makes it movable.
///
/// Storage reads this to work out the game's own folder and its size, so it
/// should point at the install (or the `bin` inside it), not at the launcher.
fn install_folder_section(ui: &mut egui::Ui, app: &App, theme: Theme, view: &mut EditorView) {
    let folders = &app.settings.library_folders;
    let mut install = view
        .draft
        .install_dir
        .as_ref()
        .map(|p| p.to_string_lossy().to_string())
        .unwrap_or_default();

    common::card(&theme, ui, |ui| {
        ui.set_width(ui.available_width());
        common::section_header(&theme, ui, "Install folder", Some("what Storage tracks"));
        ui.add_space(space::MD);

        if folders.is_empty() {
            note(
                ui,
                theme,
                "Set one up on the Storage page and Orbit can report what this game takes and move it between drives.",
            );
            ui.add_space(space::SM);
        }

        ui.horizontal(|ui| {
            ui.add(
                egui::TextEdit::singleline(&mut install)
                    .desired_width((ui.available_width() - 180.0).max(120.0))
                    .hint_text(r"D:\Games\Hades\bin")
                    .text_color(theme.text),
            );
            if common::secondary_button(&theme, ui, "Browse\u{2026}").clicked() {
                if let Some(p) = rfd::FileDialog::new().pick_folder() {
                    install = p.to_string_lossy().to_string();
                }
            }
            if !install.trim().is_empty() && theme.subtle_button(ui, "Clear").clicked() {
                install.clear();
            }
        });

        view.draft.install_dir =
            (!install.trim().is_empty()).then(|| PathBuf::from(install.trim()));

        // What storage will make of it, before the game is even saved.
        if let Some(dir) = view.draft.install_dir.clone() {
            ui.add_space(space::SM);
            let owned = folders
                .iter()
                .filter_map(|f| crate::storage::game_folder(std::slice::from_ref(f), &dir))
                .next();
            match owned {
                Some(folder) => {
                    let size = crate::storage::dir_size(&folder);
                    common::status_dot(
                        &theme,
                        ui,
                        theme.success,
                        &format!(
                            "{} takes {}  \u{b7}  Orbit can move it between your folders",
                            folder.display(),
                            crate::format::bytes(size)
                        ),
                    );
                }
                None if folders.is_empty() => {}
                None => {
                    common::status_dot(
                        &theme,
                        ui,
                        theme.warning,
                        "outside your library folders \u{b7}  Orbit will track it but never move it",
                    );
                }
            }
        }
    });
}

fn playtime_section(ui: &mut egui::Ui, theme: Theme, view: &mut EditorView) {
    common::card(&theme, ui, |ui| {
        ui.set_width(ui.available_width());
        common::section_header(&theme, ui, "Playtime", None);
        ui.add_space(space::MD);

        common::toggle_row(
            &theme,
            ui,
            "Set a fixed total",
            Some("Otherwise Orbit sums your logged sessions"),
            &mut view.override_total,
        );

        if view.override_total {
            ui.add_space(space::SM);
            ui.horizontal(|ui| {
                ui.add(
                    egui::DragValue::new(&mut view.manual_total_hours)
                        .speed(0.5)
                        .range(0.0..=100_000.0)
                        .suffix(" h"),
                );
                ui.label(
                    RichText::new(format::duration(
                        (view.manual_total_hours * 3600.0).round() as i64
                    ))
                    .size(type_size::SMALL)
                    .strong()
                    .color(theme.accent),
                );
            });
        }
    });
}

fn notes_section(ui: &mut egui::Ui, theme: Theme, view: &mut EditorView) {
    common::card(&theme, ui, |ui| {
        ui.set_width(ui.available_width());
        common::section_header(&theme, ui, "Notes", None);
        ui.add_space(space::MD);
        ui.add(
            egui::TextEdit::multiline(&mut view.notes_edit)
                .desired_rows(4)
                .desired_width(ui.available_width())
                .hint_text("Patch notes, where saves are, reminders\u{2026}")
                .text_color(theme.text),
        );
    });
}

/// A muted explanatory line, for the parts of the form that need a sentence.
fn note(ui: &mut egui::Ui, theme: Theme, text: &str) {
    ui.add(
        egui::Label::new(
            RichText::new(text)
                .size(type_size::SMALL)
                .color(theme.text_faint),
        )
        .wrap(),
    );
}

/// A button that cannot be pressed, drawn so it does not look like it can.
fn disabled_button(theme: Theme, ui: &mut egui::Ui, label: &str) -> egui::Response {
    egui::Frame::new()
        .fill(theme.surface_alt)
        .stroke(egui::Stroke::new(1.0_f32, theme.border))
        .corner_radius(radius::SM)
        .inner_margin(egui::Margin::symmetric(space::LG as i8, space::SM as i8))
        .show(ui, |ui| {
            ui.label(
                RichText::new(label)
                    .size(type_size::BODY)
                    .strong()
                    .color(theme.text_faint),
            );
        })
        .response
}

fn save(ui: &mut egui::Ui, app: &mut App, theme: Theme, view: &mut EditorView) -> bool {
    common::primary_button(&theme, ui, save_label(view)).clicked() && build_and_save(app, view)
}

/// A labelled path field with a browse button. Files and folders share this so
/// every path in the form behaves the same way.
fn path_row(ui: &mut egui::Ui, theme: Theme, text: &mut String, label: &str, extensions: &[&str]) {
    ui.horizontal(|ui| {
        ui.label(RichText::new(label).size(type_size::BODY).color(theme.text));
        ui.add(
            egui::TextEdit::singleline(text)
                .desired_width((ui.available_width() - 190.0).max(80.0))
                .text_color(theme.text),
        );
        if theme.subtle_button(ui, "Browse\u{2026}").clicked() {
            let mut dlg = rfd::FileDialog::new().set_title(label);
            if !extensions.is_empty() {
                dlg = dlg.add_filter("Files", extensions);
            }
            if let Some(p) = dlg.pick_file() {
                *text = p.to_string_lossy().to_string();
            }
        }
    });
}

/// Copy metadata fields from an IGDB record into the draft.
fn merge_meta(draft: &mut Game, meta: &Game) {
    draft.description = meta.description.clone();
    draft.developer = meta.developer.clone();
    draft.publisher = meta.publisher.clone();
    draft.release_date = meta.release_date.clone();
    draft.genres = meta.genres.clone();
    draft.platforms = meta.platforms.clone();
    if draft.rating < 0 {
        draft.rating = meta.rating;
    }
}

/// Write the draft back to the library. Returns true on success.
fn build_and_save(app: &mut App, view: &mut EditorView) -> bool {
    let name = view.name_edit.trim().to_string();
    if name.is_empty() {
        app.last_error = Some("A game needs a title.".into());
        return false;
    }

    let mut game = view.draft.clone();
    game.name = name;
    game.developer = view.dev_edit.trim().to_string();
    game.publisher = view.pub_edit.trim().to_string();
    game.genres = split_list(&view.genres_edit);
    game.platforms = split_list(&view.platforms_edit);
    game.description = view.desc_edit.clone();
    game.notes = view.notes_edit.clone();
    game.rating = view.rating;
    game.manual_playtime_secs = if view.override_total {
        (view.manual_total_hours * 3600.0).round() as i64
    } else {
        0
    };

    game.launch = match view.tab {
        LaunchTab::None => LaunchTarget::None,
        LaunchTab::Executable => {
            if view.exe_path.trim().is_empty() {
                app.last_error = Some("Choose an executable, or switch to Time only.".into());
                return false;
            }
            LaunchTarget::Executable {
                path: PathBuf::from(view.exe_path.trim()),
                args: view.exe_args.trim().to_string(),
                working_dir: if view.exe_dir.trim().is_empty() {
                    None
                } else {
                    Some(PathBuf::from(view.exe_dir.trim()))
                },
            }
        }
        LaunchTab::Steam => match App::parse_steam_id(&view.steam_id) {
            Some(app_id) => LaunchTarget::Steam { app_id },
            None => {
                app.last_error = Some("That does not look like a Steam App ID.".into());
                return false;
            }
        },
        LaunchTab::Emulator => {
            if view.emu_path.trim().is_empty() || view.rom_path.trim().is_empty() {
                app.last_error =
                    Some("An emulator setup needs both an emulator and a ROM file.".into());
                return false;
            }
            LaunchTarget::Emulator {
                emulator_path: PathBuf::from(view.emu_path.trim()),
                args_template: view.emu_args.trim().to_string(),
                rom_path: PathBuf::from(view.rom_path.trim()),
            }
        }
    };

    if view.game_id == 0 {
        app.add_game(game);
        app.last_error = None;
        true
    } else {
        game.id = view.game_id;
        let ok = app.update_game(&game);
        if ok {
            app.last_error = None;
        }
        ok
    }
}

fn split_list(raw: &str) -> Vec<String> {
    raw.split(',')
        .map(|s| s.trim())
        .filter(|s| !s.is_empty())
        .map(|s| s.to_string())
        .collect()
}

impl Default for EditorView {
    fn default() -> Self {
        Self::new()
    }
}
