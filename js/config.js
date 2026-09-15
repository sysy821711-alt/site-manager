// Azure App 註冊設定。請依照 README.md 的步驟到 Azure Portal 註冊一個免費的 App，
// 類型選「單頁應用程式 (SPA)」，redirect URI 填這個 App 實際的網址（或 http://localhost:PORT），
// 完成後把下面的 clientId 換成你自己的「應用程式 (用戶端) 識別碼」。
// 在填入真實 clientId 之前，OneDrive 同步功能會停用，其餘功能完全不受影響（純本機使用）。
const AppConfig = {
  msal: {
    clientId: 'YOUR_AZURE_APP_CLIENT_ID',
    authority: 'https://login.microsoftonline.com/common', // 同時支援個人與公司/學校 Microsoft 帳號
    redirectUri: window.location.origin + window.location.pathname
  },
  // Files.ReadWrite.AppFolder：只存取這個 App 專屬的 OneDrive 資料夾，不會動到使用者其他檔案
  graphScopes: ['Files.ReadWrite.AppFolder', 'offline_access', 'User.Read']
};
