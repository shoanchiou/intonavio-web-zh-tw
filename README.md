# Intonavio Web｜唱歌音準練習

在 Windows 或 macOS 用瀏覽器貼上 YouTube 連結，加歌、分離人聲與伴奏，再對著參考音高練唱。預設繁體中文，也可切換英文。

[開啟 GitHub Pages 入口](https://shoanchiou.github.io/intonavio-web-zh-tw/) · [官方 Intonavio 原始專案](https://github.com/pawelgawliczek/intonavio)

## 使用

1. 開啟 GitHub Pages 並使用 Google 帳號登入，選「加入歌曲」，貼上你有權下載與處理的公開 YouTube 影片連結，再選「檢查歌曲」。
2. 選「加入並做伴奏」。Render 取得音訊後，瀏覽器會分離人聲與伴奏並分析參考音高。第一次分離會下載並校驗約 67 MB 的模型，處理時請保持分頁開啟。只想跟唱時可選「加入並播放影片」。
3. 選擇原曲、人聲或伴奏，開啟麥克風並播放跟唱。可依需求變速、設 A–B 循環與儲存本次成績。建議戴耳機。

展開「麥克風設定」，可先測試輸入峰值並調整增益。啟用「自動增益」後，增益會跟著輸入音量調整，百分比會顯示目前的增益。若顯示原始輸入達到滿刻度，請調低系統或音訊介面的麥克風增益。

音高圖在載入歌曲時依整首參考旋律的音域排好刻度。播放、拖曳與 A–B 循環時維持同一組音高刻度。播放、音軌、速度和 A–B 循環都在圖下方。

本機版送出工作後，可關閉分頁或重新整理。用同一瀏覽器重新開啟本機網址即可接回進度。工作完成後，頁面會把音軌與參考音高存進曲庫。運算時請讓本機服務繼續執行，關閉服務或電腦會中止尚未完成的工作。本機工作暫存會在後續有新工作時清除超過 48 小時的紀錄。

可匯入自己的音檔在瀏覽器處理。若網頁取不到 YouTube 音訊，也可從「練唱方式」取得 Windows 或 Mac 練唱工具。歌曲、音軌與成績存在目前瀏覽器，換電腦或瀏覽器不會同步。清除網站資料前可下載人聲與伴奏備份。

## 本機版環境

需要 Node.js 22.12 以上、yt-dlp、FFmpeg、Deno 和 Python 3.13。

- **Windows**：雙擊 `啟動唱歌音準練習.cmd`。缺少依賴時可透過啟動器選擇使用 Windows 套件管理員安裝。
- **macOS 14 以上**：支援 Apple Silicon（M 系列）和 Intel。首次透過 Homebrew 安裝建議使用 macOS 15 以上。將套件解壓縮到使用者可寫入的資料夾，雙擊 `啟動唱歌音準練習.command`。缺少依賴時，可讓啟動器透過 [Homebrew](https://brew.sh/) 安裝。第一次使用 Homebrew 請按照官方網站安裝說明；要自行安裝依賴，可執行 `brew install node yt-dlp ffmpeg deno python@3.13`。也可從解壓縮的資料夾在「終端機」執行 `/bin/bash ./啟動唱歌音準練習.command`。Apple Silicon 請使用原生 arm64 的終端機與依賴；Intel 會使用提供 Intel 版套件的 ONNX Runtime 1.23.2。

如果 Mac 版說 YouTube 下載工具 `yt-dlp` 太舊，先在舊的終端機視窗按 Control+C，再下載最新版套件並開啟 `啟動唱歌音準練習.command`。看到更新提示時輸入 `y`，啟動器會透過 Homebrew 更新。

Mac 啟動器也會檢查 `ffmpeg` 和 `ffprobe` 是否能執行。兩個工具都是 Homebrew 的 `ffmpeg` 套件提供的，看到補裝或修復提示時輸入 `y`。

## Render 雲端取音

正式 GitHub Pages 使用 `https://intonavio-audio.onrender.com` 取得 YouTube 音訊。YouTube 可能對部分取音請求要求驗證。遇到取音失敗可試另一支有權處理的影片，或匯入音檔。

`render.yaml` 和 `Dockerfile.render` 提供雲端取音服務。從 Render 網頁用公開 Git 儲存庫建立 **Web Service**，選 Docker、`./Dockerfile.render`、Free 和健康檢查 `/health`，或使用 Blueprint 建立。取音沿用下節的 Google 登入設定。

如果 YouTube 要求登入驗證，在 Render 的 **Environment → Secret Files** 設定 Netscape 格式的 `cookies.txt` 並重新部署。後端從 `/etc/secrets/cookies.txt` 讀取檔案。有 Cookie 時，取音只接受 YouTube 標記為公開的影片。缺少檔案時，服務會嘗試以訪客身分取音。Cookie 是 YouTube 登入憑證，請存放在 Render 的 Secret Files。

其他部署可用前端建置變數 `VITE_INTONAVIO_CLOUD_URL` 指定取音網址。瀏覽器會等待服務喚醒，再請 Render 驗證現有的 Google 登入並取得 MP3。分離、音高分析和歌曲保存都在瀏覽器完成。服務每次處理一首，15 分鐘最多接受六次取音，預設只允許本專案的 GitHub Pages 跨站請求。

## Google 登入

設定 Render 環境變數 `INTONAVIO_GOOGLE_CLIENT_ID`，重建服務後可驗證 Google 登入。前端用相同的 Web 用戶端 ID 建置 `VITE_INTONAVIO_GOOGLE_CLIENT_ID`，並以 `VITE_INTONAVIO_AUTH_URL` 指定驗證服務。Google Cloud 的核准 JavaScript 來源是 `https://shoanchiou.github.io`。

正式 GitHub Pages 已設定 Google 登入。登入後曲庫仍儲存在目前瀏覽器，跨裝置同步需要另外部署持久化資料庫。

## 架構與費用

GitHub Pages 提供 YouTube 串流播放、循環、變速、麥克風音高、音階暖身及本機音檔功能。本機版在 `127.0.0.1:3218` 提供網頁與背景工作，只接受這台電腦的連線。第一次處理時會建立專案專用的 Python 環境，並下載、校驗人聲模型。

使用原版的本機下載概念，由 yt-dlp、Deno 與 FFmpeg 取得音訊，再由本機服務用 CPU 完成人聲分離與參考音高分析。本機頁可把本機音檔送至同一服務。GitHub Pages 上的本機音檔分離仍在瀏覽器內執行，需保持分頁開啟。原曲長度上限 8 分鐘，檔案最多 100 MB。YouTube 可限制部分影片的音訊取得或嵌入，請依 YouTube 條款與影片授權使用。本版本不需要 StemSplit、Cloudflare R2、Docker 或付費 API。模型下載及 YouTube 匯入需要連線，音檔與麥克風訊號在本機處理。

## 原版功能如何移植

| 原版                                                                  | 此版做法                                                                                                                                                                   |
| --------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| SwiftUI 曲庫、加歌與練唱                                              | 沿用加歌、曲目確認、準備音軌、鋼琴卷軸、切換音軌的動線，以網頁介面重寫。                                                                                                   |
| YouTube URL 解析、oEmbed 預覽、`workers/stem-splitter/src/youtube.py` | 沿用影片 ID 型式和原版 oEmbed、yt-dlp → FFmpeg 處理方式。改由 本機服務執行，不使用瀏覽器登入憑證。                                                                         |
| `YouTubeHTML.swift`、`VideoPlayerProtocol`                            | 沿用 IFrame 播放 API，將 Swift WKWebView 橋接改為瀏覽器事件。由本機音軌時間帶動靜音影片。                                                                                  |
| `YINDetector.swift`、`ScoringEngine.swift`、循環與音軌控制            | 移植 YIN、音分比較、三種難度與 A–B 賦值方式。瀏覽器 AudioWorklet 偵測麥克風，Canvas 繪製音高圖。                                                                           |
| 官方 Draft 與 Studio 兩種音軌                                         | 使用 MDX 分離人聲。瀏覽器透過 SwiftF0 分析參考旋律，本機背景工具使用 YIN。                                                                  |
| 帳號、歌詞同步、參考音高編輯與進階練習                                | 本版未完整移植。GitHub 帳號用來管理專案，練唱頁本身不需登入。                                                                                                              |

官方基準為 `f3fc917a6f989e707817b9d06743b330c194a70a`。上游原始碼保存在 D 槽 `source` 資料夾，這個網頁專案存於 `web`。每次修改請先在本機執行 `npm run build`，再更新 GitHub 的建置結果。

程式保留 [Intonavio 的 MIT 授權](./LICENSE)。瀏覽器分離使用 [web-audio-separation](https://github.com/incidentist/web-audio-separation)、[ONNX Runtime Web](https://github.com/microsoft/onnxruntime) 及 [UVR MDX 模型鏡像](https://huggingface.co/Blane187/all_public_uvr_models)。
原唱參考音高使用 Lars Nieradzik 的 [SwiftF0 模型](https://github.com/lars76/swift-f0/tree/d1ba77fe5331310b778ebe126b6cb3656d41d24f)（[MIT 授權](./public/licenses/swift-f0.txt)）。
