# Life OS v0.2 — iPhone Widget + Notifications starter

v0.1のWeb版を、iPhoneネイティブアプリへ載せるための実装スターターです。

## v0.2で追加したもの

- iPhoneホーム画面ウィジェット（WidgetKit）
  - NEXT ACTION
  - 開始/終了時刻
  - 今日の予定作業量
  - ゆったり時間
  - 中サイズでは次の予定も表示
- iPhoneローカル通知
  - タスク開始前（初期値5分、Web画面から変更可能）
  - お風呂＋肌ケアも通知対象
  - Google Calendarの固定予定は重複通知を避けるためLife OS側では通知しない
- Web版→iOSネイティブの連携ブリッジ
  - 今日の計画をApp Groupへ保存
  - ウィジェット更新
  - 通知再予約
- Google CalendarをiOSネイティブGoogle Sign-Inで取得するコード
  - 読み取り専用 scope: `https://www.googleapis.com/auth/calendar.readonly`
  - 取得した予定をWeb側の自動計画へ注入
- PWA manifest / service worker（Web版をホーム画面へ置くための基礎）

## フォルダ

- `WebApp/` : Life OS本体（HTML/CSS/JS）
- `iOS/LifeOS/` : iOSアプリ側Swiftコード
- `iOS/LifeOSWidget/` : WidgetKit extension側Swiftコード
- `XCODE_SETUP.md` : XcodeでiPhoneへ入れるまでの手順

## 重要

このZIPは「Xcodeでビルドするためのソース一式」です。Linux環境ではXcode/iOS SDKがないため、ここでは`.ipa`の署名ビルドまでは実行していません。
