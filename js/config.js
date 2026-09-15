// Azure App 註冊設定。請依照 README.md 的步驟到 Azure Portal 註冊一個免費的 App，
// 類型選「單頁應用程式 (SPA)」，redirect URI 填這個 App 實際的網址（或 http://localhost:PORT），
// 完成後把下面的 clientId 換成你自己的「應用程式 (用戶端) 識別碼」。
// 在填入真實 clientId 之前，OneDrive 同步功能會停用，其餘功能完全不受影響（純本機使用）。
const AppConfig = {
  msal: {
    clientId: 'E7FC7BF2-9D5A-48E6-95C1-58AC119AD3C9',
    authority: 'https://login.microsoftonline.com/common', // 同時支援個人與公司/學校 Microsoft 帳號
    // 固定算成資料夾路徑（去掉 index.html），不管使用者是用 .../site-manager/ 還是
    // .../site-manager/index.html 進入，redirectUri 都一致，才不會跟 Azure 登記的網址對不上
    redirectUri: window.location.origin + window.location.pathname.replace(/index\.html$/, '')
  },
  // Files.ReadWrite.AppFolder：只存取這個 App 專屬的 OneDrive 資料夾，不會動到使用者其他檔案
  graphScopes: ['Files.ReadWrite.AppFolder', 'offline_access', 'User.Read']
};
