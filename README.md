# Intonavio Web｜唱歌音準練習

在 Windows 用瀏覽器貼上 YouTube 連結，加歌、分離人聲與伴奏，再對著參考音高練唱。預設繁體中文，也可切換英文。

[開啟 GitHub Pages 入口](https://shoanchiou.github.io/intonavio-web-zh-tw/) · [官方 Intonavio 原始專案](https://github.com/pawelgawliczek/intonavio)

## 使用

1. 開啟 GitHub Pages，直接加入 YouTube 影片、播放或開麥克風看音高。如需分離 YouTube 音軌和跟原唱比較，從「環境設定」下載 Windows 套件並解壓縮，雙擊 `啟動唱歌音準練習.cmd`。保留啟動視窗，瀏覽器會開啟 `http://127.0.0.1:3218/`。
2. 選「加入歌曲」，貼上你有權下載與處理的公開 YouTube 影片連結，再選「檢查歌曲」與「加入並處理歌曲」。第一次分離會下載並校驗約 67 MB 的模型。
3. 選擇原曲、人聲或伴奏，開啟麥克風並播放跟唱。可依需求變速、設 A–B 循環與儲存本次成績。建議戴耳機。

歌曲也可透過本機音檔匯入。歌曲、音軌與成績存在目前瀏覽器，換電腦或瀏覽器不會同步。清除網站資料前可下載人聲與伴奏備份。

## 架構與費用

GitHub Pages 提供 YouTube 串流播放、循環、變速、麥克風音高、音階暖身及本機音檔功能。YouTube 音軌處理需要 Windows 本機服務，Node.js 在 `127.0.0.1:3218` 同時提供網頁和音訊取得。保留啟動視窗即可，關閉視窗後服務停止。Windows 版需要 Node.js 22.12+、yt-dlp、FFmpeg 和 Deno。缺少時可在啟動器選擇透過 Windows 套件管理員安裝，也可自行加入 PATH。

使用原版的本機下載概念，由 yt-dlp、Deno 與 FFmpeg 取得音訊，再由瀏覽器進行人聲分離與音高分析。原曲長度上限 8 分鐘，檔案最多 100 MB。YouTube 可限制部分影片的音訊取得或嵌入，請依 YouTube 條款與影片授權使用。本版本不需要 StemSplit、Cloudflare R2、Docker 或付費 API。模型下載及 YouTube 匯入需要連線，音檔與麥克風訊號在本機處理。

## 原版功能如何移植

| 原版                                                                  | 此版做法                                                                                                                                                                                         |
| --------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| SwiftUI 曲庫、加歌與練唱                                              | 沿用加歌、曲目確認、準備音軌、鋼琴卷軸、切換音軌的動線，以網頁介面重寫。                                                                                                                         |
| YouTube URL 解析、oEmbed 預覽、`workers/stem-splitter/src/youtube.py` | 沿用影片 ID 型式和原版 oEmbed、yt-dlp → FFmpeg 處理方式。改由 Windows 本機服務執行，不使用瀏覽器登入憑證。                                                                                       |
| `YouTubeHTML.swift`、`VideoPlayerProtocol`                            | 沿用 IFrame 播放 API，將 Swift WKWebView 橋接改為瀏覽器事件。由本機音軌時間帶動靜音影片。                                                                                                        |
| `YINDetector.swift`、`ScoringEngine.swift`、循環與音軌控制            | 移植 YIN、音分比較、三種難度與 A–B 賦值方式。瀏覽器 AudioWorklet 偵測麥克風，Canvas 繪製音高圖。                                                                                                 |
| 官方 Draft 與 Studio 兩種音軌                                         | 原版 Draft 的 BS-Roformer 依賴 Python、Redis 與 R2，Studio 依賴 StemSplit。這個網頁採可在瀏覽器運行的 MDX vocal 模型，先取得人聲，再用 Worker 分析參考音高。輸出與參考分析結果可能與官方版不同。 |
| 帳號、歌詞同步、參考音高編輯與進階練習                                | 本版未完整移植。GitHub 帳號用來管理專案，練唱頁本身不需登入。                                                                                                                                    |

官方基準為 `f3fc917a6f989e707817b9d06743b330c194a70a`。上游原始碼保存在 D 槽 `source` 資料夾，這個網頁專案存於 `web`。每次修改請先在本機執行 `npm run build`，再更新 GitHub 的建置結果。

程式保留 [Intonavio 的 MIT 授權](./LICENSE)。瀏覽器分離使用 [web-audio-separation](https://github.com/incidentist/web-audio-separation)、[ONNX Runtime Web](https://github.com/microsoft/onnxruntime) 及 [UVR MDX 模型鏡像](https://huggingface.co/Blane187/all_public_uvr_models)。
