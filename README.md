# AI駆動型 高性能Discord文字起こしBot

このBotは、指定されたDiscordのボイスチャンネルで行われる会話を自動的に録音し、`faster-whisper`による高精度な文字起こしと、GoogleのGemini APIによるテキストの整形・要約・質問応答を組み合わせた、高機能な文字起こしサービスを提供します。

## 主な機能

- **自動録音**: ユーザーが特定のボイスチャンネルに参加すると自動で録音を開始し、退出すると録音を終了します。
- **高精度文字起こし**: CPU環境でも高速に動作する`faster-whisper`を利用し、正確な文字起こしを実現します。
- **AIによるテキスト整形・要約**: Gemini APIを活用し、生のテキストから誤字脱字やフィラーワード（「えーっと」など）を除去し、読みやすいように構造化・要約します。
- **対話型Q&A**: 生成された文字起こしファイルの内容について、Botに質問することができます。
- **モデル選択**: 用途に応じて、要約やQ&Aに使用するGeminiのモデルを `gemini-1.5-pro` と `gemini-1.5-flash` から選択できます。
- **耐障害性**: 独自の永続的ジョブキューにより、Botが予期せず再起動しても処理中のタスクが失われることはありません。

## 導入と設定

### 必須環境
- Node.js (v18以上)
- Python (v3.9以上)
- FFmpeg (システムのPATHに登録されていること)

### インストール手順

1.  **リポジトリのクローン** (もしGitを使用している場合):
    ```bash
    git clone <リポジトリURL>
    cd discord-transcription-bot
    ```

2.  **Node.js依存関係のインストール**:
    ```bash
    npm install
    ```

3.  **Python依存関係のインストール**:
    ```bash
    pip install -r requirements.txt
    ```

4.  **環境変数の設定**:
    -   プロジェクトのルートに`.env`という名前のファイルを作成します。
    -   以下の内容をファイルに記述し、あなたのキーに置き換えてください。

    ```env
    # Discord Developer Portalから取得したBotのトークン
    DISCORD_TOKEN=YOUR_DISCORD_BOT_TOKEN

    # Google AI Studioから取得したAPIキー
    GEMINI_API_KEY=YOUR_GEMINI_API_KEY
    ```

## 利用方法

1.  **Botとワーカーの起動**:
    -   ターミナルを2つ開きます。
    -   1つ目のターミナルでBotを起動します:
        ```bash
        node index.js
        ```
    -   2つ目のターミナルでワーカーを起動します:
        ```bash
        node worker.js
        ```

2.  **Discordサーバーへの招待**:
    -   Discord Developer Portalで、あなたのBotに`bot`と`application.commands`のスコープ、そして「管理者」権限を付与して招待リンクを生成し、サーバーに招待します。

3.  **初期設定 (`/setup`)**:
    -   サーバー内で、管理者権限を持つユーザーが`/setup`コマンドを実行します。
    -   **category**: 録音対象としたいボイスチャンネルが含まれる「カテゴリ」を選択します。
    -   **output**: 文字起こし結果を投稿する「テキストチャンネル」を選択します。
    -   これにより、デフォルトのAIモデルとして `gemini-1.5-flash` が設定されます。

4.  **録音の開始**:
    -   設定が完了すると、指定されたカテゴリ内のボイスチャンネルにユーザーが入室するたびに、そのユーザーの音声が個別に録音されます。

5.  **文字起こしの実行と投稿 (`/finalize`)**:
    -   録音された音声は、バックグラウンドで順次文字起こしされます。
    -   会議や議論が終了したら、管理者が`/finalize`コマンドを実行し、対象の`session_id`を指定して手動でセッションを完了させます。
    -   整形・要約されたテキストファイルが、設定したチャンネルに投稿されます。

6.  **Q&A機能**:
    -   Botが投稿した`.txt`ファイルに**返信（リプライ）**する形で質問を送信すると、Botがファイルの内容に基づいて回答します。

7.  **AIモデルの変更 (`/model`)**:
    -   必要に応じて、管理者は`/model`コマンドでAIモデルを `gemini-1.5-pro` (高性能) または `gemini-1.5-flash` (高速) に切り替えることができます。
