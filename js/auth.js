// Microsoft 帳號登入（MSAL），供 OneDrive 同步使用
const Auth = (() => {
  let msalInstance = null;
  let account = null;

  function isConfigured() {
    return !!(AppConfig.msal.clientId && AppConfig.msal.clientId !== 'YOUR_AZURE_APP_CLIENT_ID');
  }

  function getInstance() {
    if (!msalInstance) {
      msalInstance = new msal.PublicClientApplication({
        auth: {
          clientId: AppConfig.msal.clientId,
          authority: AppConfig.msal.authority,
          redirectUri: AppConfig.msal.redirectUri
        },
        cache: { cacheLocation: 'localStorage' }
      });
    }
    return msalInstance;
  }

  async function init() {
    if (!isConfigured()) return null;
    const instance = getInstance();
    await instance.initialize();
    let response = null;
    try {
      response = await instance.handleRedirectPromise();
    } catch (e) {
      console.error('MSAL redirect 處理失敗', e);
    }
    if (response && response.account) {
      account = response.account;
    } else {
      const accounts = instance.getAllAccounts();
      if (accounts.length) account = accounts[0];
    }
    return account;
  }

  function getAccount() {
    return account;
  }

  async function login() {
    if (!isConfigured()) {
      throw new Error('尚未設定 Azure App clientId，請參考 README.md 完成 OneDrive 同步設定');
    }
    const instance = getInstance();
    const result = await instance.loginPopup({ scopes: AppConfig.graphScopes });
    account = result.account;
    return account;
  }

  async function logout() {
    if (!account) return;
    const instance = getInstance();
    await instance.logoutPopup({ account });
    account = null;
  }

  async function getToken() {
    if (!account) throw new Error('尚未登入 Microsoft 帳號');
    const instance = getInstance();
    try {
      const result = await instance.acquireTokenSilent({ scopes: AppConfig.graphScopes, account });
      return result.accessToken;
    } catch (e) {
      const result = await instance.acquireTokenPopup({ scopes: AppConfig.graphScopes });
      account = result.account;
      return result.accessToken;
    }
  }

  return { init, isConfigured, getAccount, login, logout, getToken };
})();
