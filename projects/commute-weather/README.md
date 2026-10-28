# 電車遅延・天気通知システム

通学前に電車の運行状況と天気をまとめて確認できるように作った、個人制作のシステムです。PCのPythonプログラムとArduinoを連携させ、LINE通知とLCD・RGB LEDで情報を受け取れるようにしました。コンテストで優秀賞を受賞しました。

## 仕組み

~~~mermaid
flowchart LR
  A[運行情報・天気] --> B[Pythonで取得・解析]
  B --> C[LINE通知]
  B --> D[シリアル通信]
  D --> E[Arduino LCD・RGB LED]
  F[Arduinoのボタン] -->|CHECK| B
~~~

## できること

- 副都心線・東武東上線・山手線・中央線・東西線・丸ノ内線・銀座線の運行情報を取得します。
- 天気、最高気温、時間帯別の降水確率を取得し、傘や雪への注意をLINEに送ります。
- 1日3回の定時更新に加え、Arduinoのボタンを押してCHECK信号を送ると、情報を再取得します。
- 取得失敗や想定外のページ構造を平常運転と誤認しないよう、エラーとして扱います。
- 天気・気温・主要2路線の状態をLCDに表示し、遅延や雨をRGB LEDで知らせます。

## 使用したもの

Python、Arduino、Requests、BeautifulSoup、schedule、PySerial、LINE Messaging API、I2C LCD、RGB LED、押しボタン。

## 起動方法

Python 3を用意し、依存ライブラリを入れます。

~~~sh
pip install -r requirements.txt
~~~

LINE Messaging APIのアクセストークンと通知先ユーザーIDを、環境変数LINE_ACCESS_TOKEN、LINE_USER_IDに設定します。Arduinoのシリアルポートを使う環境では、ARDUINO_PORT（既定値COM5）も必要に応じて変更してください。

~~~text
ARDUINO_PORT=COM5
ARDUINO_BAUD_RATE=9600
LINE_ACCESS_TOKEN=自分のアクセストークン
LINE_USER_ID=自分の通知先ID
~~~

設定後、Arduinoを接続して実行します。

~~~sh
python commute_alert.py
~~~

このスケッチはWire、LiquidCrystal_I2Cを使用します。LCDはI2Cアドレス0x27、シリアル通信は9600 baudを想定しています。RGB LEDは9・10・11番ピン、ボタンは2番ピンに接続する設定です。実物に合わせて配線と設定を確認してください。

## ファイル

- commute_alert.py: 天気・運行情報の取得、解析、LINE通知、Arduinoとの通信
- sketch_jan4a.ino: LCD・RGB LEDの表示と、ボタン操作のスケッチ
- requirements.txt: Pythonの依存ライブラリ

## 制作について

ハードウェアとソフトウェアを一人で制作し、実機で動かしてコンテストの優秀賞を受賞しました。作品名・コンテスト名・受賞年は確認でき次第追記します。

このコードは取得元WebサイトのHTML構造に依存します。サイト側の変更や通信障害により、情報を取得できない場合があります。運行判断や安全に関わる情報は、鉄道会社・気象機関の公式情報でも確認してください。
