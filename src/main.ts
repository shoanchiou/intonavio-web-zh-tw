import "./style.css";
import { analyzeReference, decodeAudio } from "./analyze";
import {
  cancelJob,
  JobError,
  rememberJob,
  restoreJob,
  submitJob,
  watchJob,
  type JobStage,
  type PendingJob,
} from "./background";
import { cloudUrl, fetchCloudAudio } from "./cloud";
import { makeDemo } from "./demo";
import { element } from "./dom";
import { locale, setLocale, t } from "./i18n";
import { formatTime } from "./pitch";
import { Practice } from "./practice";
import { SeparationTask, type SeparationStage } from "./separate";
import { deleteSong, listSongs, saveSong } from "./storage";
import type { Difficulty, Song } from "./types";
import {
  extractVideoId,
  isLocalApp,
  previewVideo,
  LOCAL_URL,
  type VideoInfo,
} from "./youtube";

const cloudActive = Boolean(cloudUrl) && !isLocalApp;
const library = element("library");
const status = element("status");
const progress = element<HTMLProgressElement>("processing-progress");
const fileInput = element<HTMLInputElement>("file");
const dialog = element<HTMLDialogElement>("add-dialog");
const linkInput = element<HTMLInputElement>("youtube-url");
const preview = element("youtube-preview");
const separation = new SeparationTask();
const practice = new Practice(showStatus);
let songs: Song[] = [];
let selected: Song | undefined;
let video: VideoInfo | undefined;
let busy = false;
let canCancel = false;
let request: AbortController | undefined;
let backgroundJob: PendingJob | undefined;
let previewRequest: AbortController | undefined;
let downloadUrls: string[] = [];

function showStatus(message: string, kind = ""): void {
  status.textContent = message;
  status.className = kind;
}
function showError(error: unknown): void {
  const cancelled =
    error instanceof DOMException && error.name === "AbortError";
  showStatus(
    cancelled
      ? t("cancelled")
      : error instanceof Error
        ? error.message
        : String(error),
    cancelled ? "" : "error",
  );
}
function select(song?: Song): void {
  selected = song;
  practice.select(song);
  renderLibrary();
  renderActions();
}
function setBusy(value: boolean, cancellable = false): void {
  busy = value;
  canCancel = value && cancellable;
  progress.hidden = !value;
  if (value) progress.removeAttribute("value");
  for (const id of [
    "add-song",
    "import",
    "demo",
    "setup-add-song",
    "setup-cloud-song",
    "setup-import-file",
  ])
    element<HTMLButtonElement>(id).disabled = value;
  renderLibrary();
  renderActions();
}
async function persist(song: Song): Promise<void> {
  await saveSong(song);
  songs = [song, ...songs.filter((item) => item.id !== song.id)].sort(
    (a, b) => b.createdAt - a.createdAt,
  );
  select(song);
}

function renderLibrary(): void {
  element("song-count").textContent = String(songs.length);
  library.replaceChildren();
  if (!songs.length) {
    const empty = document.createElement("p");
    empty.className = "empty";
    empty.textContent = t("emptyHint");
    library.append(empty);
  }
  for (const song of songs) {
    const item = document.createElement("div");
    item.className = "song-item";
    const button = document.createElement("button");
    button.className = `song-button${song === selected ? " active" : ""}`;
    button.disabled = busy;
    button.title = song.title;
    if (song.videoId) {
      const image = document.createElement("img");
      image.src = `https://i.ytimg.com/vi/${song.videoId}/mqdefault.jpg`;
      image.alt = "";
      image.loading = "lazy";
      button.append(image);
    }
    const title = document.createElement("strong");
    title.textContent = song.title;
    const detail = document.createElement("small");
    detail.textContent = [
      song.artist,
      song.duration ? formatTime(song.duration) : "YouTube",
    ]
      .filter(Boolean)
      .join(" · ");
    button.append(title, detail);
    button.onclick = () => {
      showStatus("");
      select(song);
    };
    const remove = document.createElement("button");
    remove.className = "song-delete";
    remove.textContent = "×";
    remove.setAttribute("aria-label", `${t("delete")} ${song.title}`);
    remove.disabled = busy;
    remove.onclick = () => {
      if (!window.confirm(t("confirmDelete"))) return;
      void deleteSong(song.id)
        .then(() => {
          songs = songs.filter((item) => item.id !== song.id);
          select(selected?.id === song.id ? songs[0] : selected);
        })
        .catch(showError);
    };
    item.append(button, remove);
    library.append(item);
  }
}

function renderActions(): void {
  element<HTMLButtonElement>("separate").disabled = !selected || busy;
  element<HTMLButtonElement>("analyze").disabled = !selected?.original || busy;
  element<HTMLAnchorElement>("watch-video").hidden = !selected?.videoId;
  element<HTMLAnchorElement>("watch-video").href = selected?.videoId
    ? `https://www.youtube.com/watch?v=${selected.videoId}`
    : "#";
  element("cancel").hidden = !canCancel;
  const links = element("downloads");
  links.replaceChildren();
  downloadUrls.forEach((url) => URL.revokeObjectURL(url));
  downloadUrls = [];
  const song = selected;
  if (song)
    for (const [kind, label] of [
      ["vocals", "downloadVocals"],
      ["instrumental", "downloadInstrumental"],
    ] as const) {
      if (!song[kind]) continue;
      const link = document.createElement("a");
      const url = URL.createObjectURL(song[kind]);
      downloadUrls.push(url);
      link.href = url;
      link.download = `${song.title}-${t(kind)}.${song[kind].type.includes("mpeg") ? "mp3" : "wav"}`;
      link.textContent = t(label);
      links.append(link);
    }
  const history = element("history");
  history.replaceChildren();
  if (!song?.history.length) {
    const empty = document.createElement("p");
    empty.className = "muted";
    empty.textContent = t("noHistory");
    history.append(empty);
  }
  for (const record of song?.history ?? []) {
    const row = document.createElement("div");
    row.className = "history-row";
    const text = document.createElement("span");
    text.textContent = `${new Date(record.date).toLocaleString(locale)} · ${t(record.difficulty as Difficulty)} · ${t(record.isLoop ? "loopSession" : "session")}`;
    const score = document.createElement("strong");
    score.textContent = `${record.score}%`;
    row.append(text, score);
    history.append(row);
  }
}

function updateProgress(stage: JobStage, fraction: number): void {
  progress.value = fraction;
  showStatus(`${t(stage)} ${Math.round(fraction * 100)}%`);
}

function updateBrowserProgress(
  stage: SeparationStage | "analyzing",
  fraction?: number,
  split = true,
): void {
  const part =
    stage === "download" || stage === "loading-model"
      ? 1
      : stage === "analyzing"
        ? 3
        : 2;
  const label = `${split ? `${part}/3 · ` : ""}${t(stage)}`;
  if (fraction !== undefined && fraction >= 0 && fraction < 1) {
    progress.value = fraction;
    showStatus(`${label} ${Math.floor(fraction * 100)}%`);
  } else {
    progress.removeAttribute("value");
    showStatus(label);
  }
}

async function processSong(song: Song, split: boolean): Promise<void> {
  const original = song.original;
  if (!original) throw new Error(t("localRequired"));
  if (split) {
    showStatus(`1/3 · ${t("decoding")}`);
    const stems = await separation.run(original, updateBrowserProgress);
    showStatus(`2/3 · ${t("savingAudio")}`);
    song = { ...song, ...stems, reference: undefined };
    await persist(song);
  }
  canCancel = false;
  renderActions();
  updateBrowserProgress("analyzing", undefined, split);
  const frames = await analyzeReference(song.vocals ?? original, (fraction) =>
    updateBrowserProgress("analyzing", fraction, split),
  );
  if (!frames.some((frame) => frame.hz)) throw new Error(t("noPitch"));
  await persist({ ...song, reference: frames });
  showStatus(t(split ? "separated" : "analyzed"), "success");
}

async function createSong(
  blob: Blob,
  title: string,
  info?: VideoInfo,
): Promise<Song> {
  if (!blob.size || blob.size > 100 * 1024 * 1024)
    throw new Error(t("tooLarge"));
  const audio = await decodeAudio(blob).catch(() => {
    throw new Error(t("decodeError"));
  });
  if (audio.duration > 480.5) throw new Error(t("tooLong"));
  return {
    id: info ? `youtube-${info.id}` : crypto.randomUUID(),
    title,
    artist: info?.artist,
    videoId: info?.id,
    original: blob,
    createdAt: Date.now(),
    duration: audio.duration,
    history: [],
  };
}

async function runTask(
  action: () => Promise<void>,
  cancellable = false,
): Promise<void> {
  if (busy) return;
  setBusy(true, cancellable);
  try {
    await action();
  } catch (error) {
    showError(error);
  } finally {
    request = undefined;
    setBusy(false);
  }
}

function runBackground(job: PendingJob, start: boolean, audio?: Blob): void {
  void runTask(async () => {
    const controller = new AbortController();
    request = controller;
    backgroundJob = job;
    if (start) rememberJob(job);
    try {
      showStatus(t("backgroundWorking"));
      if (start) {
        try {
          await submitJob(job, audio, controller.signal);
        } catch (error) {
          if (error instanceof JobError || controller.signal.aborted)
            throw error;
          // The server may have accepted the request just before the browser lost it.
        }
      }
      const result = await watchJob(
        job,
        controller.signal,
        updateProgress,
        () => showStatus(t("reconnecting")),
      );
      const existing = songs.find((song) => song.id === job.songId);
      await persist({
        ...existing,
        ...result,
        id: job.songId,
        title: job.title,
        videoId: job.videoId,
        artist: job.artist,
        createdAt: existing?.createdAt ?? Date.now(),
        history: existing?.history ?? [],
      });
      rememberJob();
      showStatus(
        result.reference.some((frame) => frame.hz)
          ? t("separated")
          : t("noPitch"),
        "success",
      );
    } catch (error) {
      if (error instanceof JobError) rememberJob();
      throw error;
    } finally {
      backgroundJob = undefined;
    }
  }, true);
}

function sendSongToBackground(
  song: { id: string; title: string; artist?: string; videoId?: string },
  source?: Blob,
): void {
  const pending = {
    id: crypto.randomUUID(),
    songId: song.id,
    title: song.title,
    artist: song.artist,
    videoId: song.videoId,
  };
  runBackground(pending, true, source);
}

const dialogStatus = element("dialog-status");
const prepareButton = element<HTMLButtonElement>("prepare");
const cloudAccess = element("cloud-access");
const cloudCode = element<HTMLInputElement>("cloud-code");
const streamButton = element<HTMLButtonElement>("add-stream");
const environmentDialog = element<HTMLDialogElement>("environment-dialog");
const setupInstructions = element<HTMLDetailsElement>("setup-instructions");
const setupPrepare = element<HTMLButtonElement>("setup-prepare-song");
const setupComputer = element<HTMLFieldSetElement>("setup-computer");

function showSetupFor(os: string): void {
  setupComputer
    .querySelectorAll<HTMLInputElement>("input")
    .forEach((option) => {
      option.checked = option.value === os;
    });
  setupInstructions
    .querySelectorAll<HTMLElement>("[data-setup-os]")
    .forEach((section) => {
      section.hidden = section.dataset.setupOs !== os;
    });
}
showSetupFor(navigator.userAgent.includes("Macintosh") ? "mac" : "windows");
setupComputer.onchange = (event) => {
  if (event.target instanceof HTMLInputElement)
    showSetupFor(event.target.value);
};
element("setup-cloud").hidden = !cloudActive;
element("setup-import").hidden = isLocalApp;
element("setup-install").hidden = isLocalApp;
element("setup-running").hidden = !isLocalApp;

function openEnvironment(videoId?: string): void {
  const url = new URL(LOCAL_URL);
  const id = videoId ?? selected?.videoId;
  if (id) url.searchParams.set("v", id);
  element<HTMLAnchorElement>("local-link").href = url.href;
  setupInstructions.open = false;
  environmentDialog.showModal();
}
element("environment").onclick = () => openEnvironment();
element("close-environment").onclick = () => environmentDialog.close();
element("setup-import-file").onclick = () => {
  environmentDialog.close();
  fileInput.click();
};
element("setup-add-song").onclick = element("setup-cloud-song").onclick =
  () => {
    environmentDialog.close();
    element("add-song").click();
  };
setupPrepare.onclick = () => {
  if (!video) return;
  const id = video.id;
  dialog.close();
  openEnvironment(id);
};
function resetPreview(): void {
  previewRequest?.abort();
  previewRequest = undefined;
  video = undefined;
  preview.replaceChildren();
  dialogStatus.textContent = "";
  prepareButton.hidden = true;
  cloudAccess.hidden = true;
  streamButton.hidden = true;
  setupPrepare.hidden = true;
}
element("add-song").onclick = () => {
  resetPreview();
  dialog.showModal();
  linkInput.focus();
};
function renderPreview(info: VideoInfo): void {
  video = info;
  const image = document.createElement("img");
  image.src = `https://i.ytimg.com/vi/${info.id}/mqdefault.jpg`;
  image.alt = "";
  const caption = document.createElement("p");
  caption.textContent = [info.title, info.artist].filter(Boolean).join(" · ");
  preview.append(image, caption);
  dialogStatus.textContent = "";
  prepareButton.hidden = !isLocalApp && !cloudActive;
  cloudAccess.hidden =
    !cloudActive ||
    songs.some((song) => song.videoId === info.id && song.original);
  streamButton.hidden = false;
  setupPrepare.hidden = isLocalApp;
}
element<HTMLFormElement>("youtube-form").onsubmit = async (event) => {
  event.preventDefault();
  resetPreview();
  const id = extractVideoId(linkInput.value);
  if (!id) {
    dialogStatus.textContent = t("badUrl");
    return;
  }
  if (!isLocalApp) {
    renderPreview({ id, title: `YouTube · ${id}`, artist: "" });
    return;
  }
  const controller = new AbortController();
  previewRequest = controller;
  dialogStatus.textContent = t("checking");
  try {
    const info = await previewVideo(id, controller.signal);
    if (controller.signal.aborted) return;
    renderPreview(info);
  } catch (error) {
    if (!controller.signal.aborted)
      dialogStatus.textContent =
        error instanceof Error ? error.message : String(error);
  }
};
linkInput.oninput = resetPreview;
element("close-dialog").onclick = () => dialog.close();
dialog.addEventListener("close", resetPreview);
streamButton.onclick = () => {
  const info = video;
  if (!info) return;
  dialog.close();
  const existing = songs.find((song) => song.videoId === info.id);
  void runTask(async () => {
    if (existing) select(existing);
    else
      await persist({
        id: `youtube-${info.id}`,
        videoId: info.id,
        title: info.title,
        artist: info.artist,
        duration: 0,
        createdAt: Date.now(),
        history: [],
      });
    showStatus("");
  });
};
prepareButton.onclick = () => {
  const info = video;
  if (!info) return;
  const existing = songs.find((song) => song.videoId === info.id);
  if (existing?.reference?.some((frame) => frame.hz)) {
    dialog.close();
    select(existing);
    showStatus(t("analyzed"), "success");
    return;
  }
  if (cloudActive) {
    const code = cloudCode.value.trim();
    if (!existing?.original && code.length < 24) {
      dialogStatus.textContent = t("cloudCodeHint");
      cloudCode.focus();
      return;
    }
    dialog.close();
    void runTask(async () => {
      if (existing?.original) return processSong(existing, true);
      const controller = new AbortController();
      request = controller;
      const audio = await fetchCloudAudio(
        info.id,
        code,
        controller.signal,
        showStatus,
      );
      const song = {
        ...(await createSong(audio, info.title, info)),
        createdAt: existing?.createdAt ?? Date.now(),
        history: existing?.history ?? [],
      };
      controller.signal.throwIfAborted();
      await persist(song);
      controller.signal.throwIfAborted();
      await processSong(song, true);
    }, true);
    return;
  }
  dialog.close();
  sendSongToBackground(
    {
      id: `youtube-${info.id}`,
      title: info.title,
      artist: info.artist,
      videoId: info.id,
    },
    existing?.original,
  );
};

element("import").onclick = () => fileInput.click();
fileInput.onchange = () => {
  const file = fileInput.files?.[0];
  fileInput.value = "";
  if (!file) return;
  void runTask(async () => {
    showStatus(t("importing"));
    await persist(await createSong(file, file.name.replace(/\.[^.]+$/, "")));
    showStatus(t("imported"), "success");
  });
};
element("demo").onclick = () =>
  void runTask(async () => {
    const song = songs.find((item) => item.id === "demo-scale-v1");
    if (song) select(song);
    else await persist(makeDemo());
    showStatus(t("analyzed"), "success");
  });
element("separate").onclick = () => {
  const song = selected;
  if (!song) return;
  if (!song.original) {
    if ((!isLocalApp && !cloudActive) || !song.videoId) {
      openEnvironment(song.videoId);
      return;
    }
    element("add-song").click();
    linkInput.value = `https://www.youtube.com/watch?v=${song.videoId}`;
    element<HTMLFormElement>("youtube-form").requestSubmit();
    return;
  }
  if (isLocalApp) sendSongToBackground(song, song.original);
  else void runTask(() => processSong(song, true), true);
};
element("analyze").onclick = () => {
  const song = selected;
  if (song) void runTask(() => processSong(song, false));
};
element("cancel").onclick = () => {
  if (backgroundJob) {
    const job = backgroundJob;
    void cancelJob(job)
      .then(() => {
        if (backgroundJob?.id !== job.id) return;
        rememberJob();
        request?.abort();
      })
      .catch(showError);
    return;
  }
  request?.abort();
  separation.cancel();
};
element("save-score").onclick = () => {
  const record = practice.score,
    song = selected;
  if (song && record && !busy)
    void persist({ ...song, history: [record, ...song.history].slice(0, 100) })
      .then(() => showStatus(t("saved"), "success"))
      .catch(showError);
};
const selector = element<HTMLSelectElement>("language");
if (isLocalApp)
  document
    .querySelector<HTMLElement>('[data-i18n="separateHint"]')
    ?.setAttribute("data-i18n", "backgroundHint");
selector.value = locale;
selector.onchange = () => {
  setLocale(selector.value === "en" ? "en" : "zh-TW");
  practice.render();
  renderLibrary();
  renderActions();
};
setLocale(locale);
element("local-link").hidden = isLocalApp;
setBusy(false);
void listSongs()
  .then((items) => {
    if (!busy && !songs.length) {
      songs = items;
      select(songs[0]);
    }
    const pending = isLocalApp ? restoreJob() : undefined;
    if (pending && !busy) {
      if (dialog.open) dialog.close();
      runBackground(pending, false);
    }
  })
  .catch(() => showStatus(t("restoreError"), "error"));
const incomingId = new URLSearchParams(location.search).get("v");
if (isLocalApp && incomingId && /^[a-zA-Z0-9_-]{11}$/.test(incomingId)) {
  element("add-song").click();
  linkInput.value = `https://www.youtube.com/watch?v=${incomingId}`;
  element<HTMLFormElement>("youtube-form").requestSubmit();
}
