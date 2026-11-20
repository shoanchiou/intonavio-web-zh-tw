import type { Song } from "./types";
import { isYouTubeIdTitle, type VideoInfo } from "./youtube";

let database: Promise<IDBDatabase> | undefined;
function openDatabase(): Promise<IDBDatabase> {
  database ??= new Promise((resolve, reject) => {
    const request = indexedDB.open("intonavio-web-local", 1);
    request.onupgradeneeded = () =>
      request.result.createObjectStore("songs", { keyPath: "id" });
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
    request.onblocked = () =>
      reject(new Error("請關閉其他 Intonavio 分頁後重試。"));
  });
  return database;
}
export async function listSongs(): Promise<Song[]> {
  const db = await openDatabase();
  return new Promise((resolve, reject) => {
    const request = db.transaction("songs").objectStore("songs").getAll();
    request.onsuccess = () =>
      resolve(
        (request.result as Song[]).sort((a, b) => b.createdAt - a.createdAt),
      );
    request.onerror = () => reject(request.error);
  });
}
export async function saveSong(song: Song): Promise<void> {
  const db = await openDatabase();
  return new Promise((resolve, reject) => {
    const transaction = db.transaction("songs", "readwrite");
    transaction.objectStore("songs").put(song);
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error);
    transaction.onabort = () =>
      reject(transaction.error ?? new Error("儲存失敗，瀏覽器空間可能不足。"));
  });
}
export async function saveVideoTitle(id: string, info: VideoInfo): Promise<void> {
  const db = await openDatabase();
  return new Promise((resolve, reject) => {
    const transaction = db.transaction("songs", "readwrite");
    const store = transaction.objectStore("songs");
    const request = store.get(id);
    request.onsuccess = () => {
      const song: Song | undefined = request.result;
      if (song?.videoId === info.id && isYouTubeIdTitle(song.title, info.id))
        store.put({ ...song, title: info.title, artist: info.artist });
    };
    transaction.oncomplete = () => resolve();
    transaction.onabort = () => reject(transaction.error);
  });
}
export async function deleteSong(id: string): Promise<void> {
  const db = await openDatabase();
  return new Promise((resolve, reject) => {
    const transaction = db.transaction("songs", "readwrite");
    transaction.objectStore("songs").delete(id);
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error);
  });
}
