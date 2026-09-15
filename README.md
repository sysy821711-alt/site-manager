# 工地管理

單一工種工班／承包商用的多工地管理 App：專案總覽、施工日誌、進度甘特圖、工地照片標註、PDF施工報告、待辦事項。

純前端 PWA（vanilla HTML/CSS/JS，無建置流程），資料存在裝置本機的 IndexedDB。照片標註與 PDF 報告完全在裝置端產生，不會經過任何伺服器。選配 OneDrive 雲端同步，讓你在手機與電腦之間共用同一份工地資料。

## 本機開發／預覽

這是純靜態網站，用任何靜態伺服器打開 `index.html` 即可，例如：

```bash
npx serve .
```

## 啟用 OneDrive 同步（選用，非必要）

不設定這一步，App 的其他功能完全不受影響，只是資料只留在單一裝置上。

1. 到 [Azure Portal → App registrations](https://portal.azure.com/#view/Microsoft_AAD_RegisteredApps/ApplicationsListBlade) 新增一個註冊（個人 Microsoft 帳號免費即可）。
2. 「支援的帳戶類型」選「任何組織目錄中的帳戶與個人 Microsoft 帳戶」。
3. 「重新導向 URI」平台選 **單頁應用程式 (SPA)**，填入這個 App 實際部署後的網址（例如 GitHub Pages 網址，或本機測試用的 `http://localhost:PORT`）。
4. 到「API permissions」新增 Microsoft Graph 的委派權限：`Files.ReadWrite.AppFolder`、`offline_access`、`User.Read`。
5. 到「Overview」複製「應用程式 (用戶端) 識別碼」，貼到 [js/config.js](js/config.js) 的 `clientId`。
6. 部署到你填的那個網址後，到 App 的「設定」分頁登入 Microsoft 帳號即可開始同步。

資料會存在 OneDrive 的 App 專屬資料夾（`Files.ReadWrite.AppFolder` 權限只能存取這個資料夾，不會動到你 OneDrive 裡的其他檔案），路徑類似 `OneDrive/應用程式/工地管理/`。

## 部署

沒有建置流程，把整個資料夾內容放到任何靜態網站空間即可（GitHub Pages、Cloudflare Pages 等）。若要啟用 OneDrive 同步，記得部署網址要跟 Azure App 註冊時填的 redirect URI 一致。
