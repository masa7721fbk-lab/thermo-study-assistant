import logging
import os
import random
import time
from datetime import datetime

import requests
import schedule
import serial
from bs4 import BeautifulSoup

# 設定値は環境変数から読み込み、秘密情報をソースコードに置かない。
ARDUINO_PORT = os.getenv("ARDUINO_PORT", "COM5")
ARDUINO_BAUD_RATE = int(os.getenv("ARDUINO_BAUD_RATE", "9600"))
LINE_ACCESS_TOKEN = os.getenv("LINE_ACCESS_TOKEN")
LINE_USER_ID = os.getenv("LINE_USER_ID")

WEATHER_URL = "https://tenki.jp/forecast/3/16/4410/13104/"
URL_FUKUTOSHIN = "https://transit.yahoo.co.jp/traininfo/detail/170/0/"
URL_TOBU = "https://transit.yahoo.co.jp/traininfo/detail/132/0/"
OTHER_LINES = [
    {"name": "JR山手線", "url": "https://transit.yahoo.co.jp/traininfo/detail/21/0/"},
    {"name": "JR中央線", "url": "https://transit.yahoo.co.jp/traininfo/detail/20/0/"},
    {"name": "東西線", "url": "https://transit.yahoo.co.jp/traininfo/detail/135/0/"},
    {"name": "丸ノ内線", "url": "https://transit.yahoo.co.jp/traininfo/detail/122/0/"},
    {"name": "銀座線", "url": "https://transit.yahoo.co.jp/traininfo/detail/121/0/"},
]

REQUEST_TIMEOUT = 8
LINE_PUSH_URL = "https://api.line.me/v2/bot/message/push"

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s %(levelname)s %(message)s",
)
logger = logging.getLogger("commute_alert")


def create_session():
    """User-Agentを設定したHTTPセッションを作成する。"""
    session = requests.Session()
    session.headers.update({"User-Agent": "Mozilla/5.0"})
    return session


def get_cheer_message():
    messages = [
        "おはよう！",
        "深呼吸してスタート！",
        "自分を大切に",
        "あなたのペースで",
        "空を見上げて",
        "今日を楽しんで",
    ]
    return random.choice(messages)


def fetch_soup(session, url, timeout=REQUEST_TIMEOUT):
    """ページを取得し、HTTPエラーを確認してからBeautifulSoupを返す。"""
    response = session.get(url, timeout=timeout)
    response.raise_for_status()
    response.encoding = response.apparent_encoding or response.encoding
    return BeautifulSoup(response.text, "html.parser")


def get_train_info(session, url, name):
    """路線の運行情報を取得する。取得不能時は平常扱いにしない。"""
    try:
        soup = fetch_soup(session, url)
        main = soup.find("div", id="main")
        status_tag = main.find("dt") if main else None
        detail_tag = main.find("dd") if main else None
        if status_tag is None or detail_tag is None:
            raise ValueError("運行情報のHTML構造を確認できません")

        status = status_tag.get_text(" ", strip=True)
        detail = detail_tag.get_text(" ", strip=True)
        return status, f"【{name}】\n{status}\n{detail}"
    except (requests.RequestException, ValueError, AttributeError) as exc:
        logger.warning("%sの運行情報を取得できません: %s", name, exc)
        return "取得失敗", f"【{name}】情報取得エラー"


def get_other_lines_status(session):
    """その他の路線の状況をLINE通知用にまとめる。"""
    report_lines = []
    for line in OTHER_LINES:
        status, message = get_train_info(session, line["url"], line["name"])
        if status == "取得失敗":
            report_lines.append(f"要確認: {message}")
        elif "平常" in status:
            report_lines.append(f"{line['name']}: 平常運転")
        else:
            report_lines.append(f"要確認: {message}")
    return "\n".join(report_lines)


def get_weather_detailed(session):
    """天気、最高気温、時間帯別の降水確率を取得する。"""
    try:
        soup = fetch_soup(session, WEATHER_URL)
        today_box = soup.find("section", class_="today-weather")
        if today_box is None:
            raise ValueError("今日の天気欄が見つかりません")

        weather_tag = today_box.find("p", class_="weather-telop")
        if weather_tag is None:
            raise ValueError("天気の表示が見つかりません")
        weather = weather_tag.get_text(" ", strip=True)

        temperature = "--"
        high_temp = today_box.find("dd", class_="high-temp")
        temp_tag = high_temp.find("span", class_="value") if high_temp else None
        if temp_tag is not None:
            temperature = temp_tag.get_text(" ", strip=True)

        rain_max = 0
        rain_detail = "降水確率を取得できません"
        rain_row = today_box.find("tr", class_="rain-probability")
        if rain_row is not None:
            labels = ["00-06", "06-12", "12-18", "18-24"]
            details = []
            for index, cell in enumerate(rain_row.find_all("td")[:4]):
                value = cell.get_text(" ", strip=True)
                details.append(f"{labels[index]}: {value}")
                try:
                    rain_max = max(rain_max, int(value.replace("%", "").strip()))
                except ValueError:
                    logger.info("降水確率を数値に変換できません: %r", value)
            if details:
                rain_detail = " / ".join(details)

        return weather, temperature, rain_detail, rain_max
    except (requests.RequestException, ValueError, AttributeError) as exc:
        logger.warning("天気情報を取得できません: %s", exc)
        return "取得失敗", "--", "降水確率を取得できません", 0


def send_line_message(session, text):
    """LINE Messaging APIでユーザーにPush Messageを送る。"""
    if not LINE_ACCESS_TOKEN or not LINE_USER_ID:
        logger.error("LINE_ACCESS_TOKENまたはLINE_USER_IDが設定されていません")
        return False

    headers = {"Authorization": f"Bearer {LINE_ACCESS_TOKEN}"}
    payload = {
        "to": LINE_USER_ID,
        "messages": [{"type": "text", "text": text}],
    }
    try:
        response = session.post(
            LINE_PUSH_URL,
            headers=headers,
            json=payload,
            timeout=REQUEST_TIMEOUT,
        )
        response.raise_for_status()
        logger.info("LINE Messaging APIへの送信に成功しました")
        return True
    except requests.RequestException as exc:
        logger.error("LINE Messaging APIへの送信に失敗しました: %s", exc)
        return False


def status_for_lcd(status):
    if status == "取得失敗":
        return "ERR"
    return "OK" if "平常" in status else "DLY"


def weather_for_lcd(weather):
    if weather == "取得失敗":
        return "Unknown"
    if "晴" in weather:
        return "Sunny"
    if "雨" in weather:
        return "Rain"
    if "曇" in weather:
        return "Cloudy"
    if "雪" in weather:
        return "Snow"
    return "Unknown"


def send_update(session, arduino):
    """情報を集め、LINE通知とArduino LCD更新を行う。"""
    logger.info("定時更新チェックを開始します")
    now_str = datetime.now().strftime("%Y/%m/%d %H:%M")

    cheer = get_cheer_message()
    status_f, message_f = get_train_info(session, URL_FUKUTOSHIN, "副都心線")
    status_t, message_t = get_train_info(session, URL_TOBU, "東武東上線")
    other_lines = get_other_lines_status(session)
    weather, temperature, rain_detail, rain_max = get_weather_detailed(session)

    if weather == "取得失敗":
        rain_alert = "天気情報を取得できません"
    elif "雪" in weather:
        rain_alert = "雪に注意してください"
    elif "雨" in weather or rain_max >= 30:
        rain_alert = "傘を持ってください"
    else:
        rain_alert = "傘は不要そうです"

    report = (
        f"日時: {now_str}\n\n"
        f"{cheer}\n\n"
        f"天気: {weather} ({temperature}℃)\n"
        f"降水確率: {rain_detail}\n"
        f"{rain_alert}\n\n"
        f"主要路線:\n{message_f}\n\n{message_t}\n\n"
        f"その他の路線:\n{other_lines}"
    )

    send_line_message(session, report)

    lcd_data = (
        f"{weather_for_lcd(weather)},{temperature},"
        f"F:{status_for_lcd(status_f)} T:{status_for_lcd(status_t)}\n"
    )
    try:
        arduino.write(lcd_data.encode("utf-8"))
        logger.info("LCDデータを送信しました: %s", lcd_data.strip())
    except (serial.SerialException, OSError) as exc:
        logger.error("Arduinoへの送信に失敗しました: %s", exc)


def main():
    # scheduleの時刻はPC側のローカル時刻に従う。
    session = create_session()

    try:
        with serial.Serial(
            ARDUINO_PORT,
            ARDUINO_BAUD_RATE,
            timeout=0.2,
            write_timeout=2,
        ) as arduino:
            # Arduinoの起動・リセットが完了するまで待つ。
            time.sleep(2)
            logger.info("システム稼働中: %s", ARDUINO_PORT)


            schedule.every().day.at("07:00").do(send_update, session, arduino)
            schedule.every().day.at("12:00").do(send_update, session, arduino)
            schedule.every().day.at("18:00").do(send_update, session, arduino)

            while True:
                schedule.run_pending()
                if arduino.in_waiting > 0:
                    command = arduino.readline().decode("utf-8", errors="ignore").strip()
                    if "CHECK" in command.upper():
                        logger.info("Arduinoから更新要求を受信しました")
                        send_update(session, arduino)
                time.sleep(0.1)
    except (serial.SerialException, OSError) as exc:
        logger.exception("Arduinoに接続できません: %s", exc)
    except KeyboardInterrupt:
        logger.info("ユーザー操作で終了しました")
    finally:
        session.close()


if __name__ == "__main__":
    main()