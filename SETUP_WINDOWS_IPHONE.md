# Life OS v0.3 — Windows + iPhone セットアップ

## できること
- Windowsだけで公開作業
- iPhoneのホーム画面からアプリ風に起動
- Google Calendar予定を読み込む
- 課題・期限・余白から今日の計画を自動生成
- 今日のLife OS計画をGoogle Calendarに同期
- 同期した予定に通知を設定

## まだできないこと
- Life OS専用の動的なiPhoneホーム画面ウィジェット（WidgetKit版）。これは後でMac/Xcode環境が必要。

## 1. GitHub Pagesへ公開（Windows）
1. GitHubにログインして、新しいPublic repositoryを `life-os` という名前で作る。
2. このフォルダの中身をすべてrepository直下へアップロードする。ZIPそのものではなく、中の `index.html`、`app.js` などをアップロードする。
3. repositoryの Settings → Pages を開く。
4. Sourceを「Deploy from a branch」にする。
5. Branchを `main`、folderを `/ (root)` にしてSave。
6. 公開URL `https://あなたのGitHubユーザー名.github.io/life-os/` を控える。

## 2. Google Calendar APIを準備（Windows）
1. Google Cloud Consoleで新しいprojectを作る（名前はLife OSでOK）。
2. APIs & Services / API Library で `Google Calendar API` を有効化する。
3. Google Auth Platformを開いて初期設定する。App nameは `Life OS`。
4. AudienceはTestingのままでよい。Test usersに、自分がLife OSで使うGoogleアカウントを追加する。
5. Clients → Create client → Web application を選ぶ。
6. Authorized JavaScript origins に `https://あなたのGitHubユーザー名.github.io` を追加する。`/life-os/` は付けない。
7. 作成後に表示される Client ID（末尾が `.apps.googleusercontent.com`）をコピーする。

## 3. iPhoneでLife OSをホーム画面へ追加
1. iPhoneのSafariで `https://あなたのGitHubユーザー名.github.io/life-os/` を開く。
2. Safariの共有ボタン →「ホーム画面に追加」。
3. ホーム画面のLife OSアイコンから起動する。

## 4. Life OSとGoogle Calendarをつなぐ
1. Life OS →「設定」。
2. Google OAuth Web Client IDへ、手順2でコピーしたClient IDを貼る。
3. 「Client IDを保存」。
4. 右上の「Google Calendar」を押す。
5. Googleの確認画面で、自分のテストユーザーのGoogleアカウントを選び、Calendar予定の表示・編集を許可する。

## 5. 課題を入れる
「課題」タブで、課題名・期限・残り必要量（分）・優先度・重点度を登録する。

例：
- IELTS Reading
- 期限 2026-09-30
- 残り 2400分
- 優先度 高
- 重点 メイン

## 6. 朝の使い方
1. Life OSを開く。
2. 終日予定があれば「実時間あり」か「予定メモ」を選ぶ。
3. 今日のNEXT ACTIONと達成予定を見る。
4. 計画に納得したら「Google Calendarへ同期（通知）」を押す。
5. Life OSが作った課題と「お風呂＋肌ケア」がGoogle Calendarに追加される。
6. 設定した通知時間（初期値5分前）にGoogle Calendar側から通知を受ける。

## 7. 通知が来ないとき（iPhone）
- Google Calendarアプリを使う場合：iPhoneの「設定」→「通知」→「Google Calendar」で通知を許可する。
- iPhone標準カレンダーにGoogleアカウントを同期して使う場合：標準カレンダーの通知を許可する。
- Life OSで再度「Google Calendarへ同期（通知）」を押し、Google Calendar上に `Life OS｜...` の予定が作られているか確認する。

## 注意
Life OS v0.3は自分用のテスト版。Google OAuthをTestingで使う場合、Google側の仕様により一定期間後に再接続が必要になることがある。
