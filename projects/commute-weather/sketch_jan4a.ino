#include <Wire.h>
#include <LiquidCrystal_I2C.h>

LiquidCrystal_I2C lcd(0x27, 16, 2);

const int PIN_R = 9;
const int PIN_G = 10;
const int PIN_B = 11;
const int BUTTON_PIN = 2;

bool isAnodeCommon = true; 
String currentTrainStatus = "";
String currentWeather = "";

// 時間管理用の変数
unsigned long previousMillis = 0;
bool ledState = false;

void setup() {
  Serial.begin(9600);
  lcd.init();
  lcd.backlight();
  pinMode(PIN_R, OUTPUT);
  pinMode(PIN_G, OUTPUT);
  pinMode(PIN_B, OUTPUT);
  pinMode(BUTTON_PIN, INPUT_PULLUP);
  
  setLED(255, 100, 0); // 起動時はオレンジ
}

void setLED(int r, int g, int b) {
  if (isAnodeCommon) {
    analogWrite(PIN_R, 255 - r);
    analogWrite(PIN_G, 255 - g);
    analogWrite(PIN_B, 255 - b);
  } else {
    analogWrite(PIN_R, r);
    analogWrite(PIN_G, g);
    analogWrite(PIN_B, b);
  }
}

void loop() {
  // --- 1. ボタン処理（delayがないので即座に反応します） ---
  if (digitalRead(BUTTON_PIN) == LOW) {
    Serial.println("CHECK");
    delay(200); // チャタリング防止の短い休み
  }

  // --- 2. データ受信処理 ---
  if (Serial.available() > 0) {
    String data = Serial.readStringUntil('\n');
    data.trim();
    int firstComma = data.indexOf(',');
    int secondComma = data.indexOf(',', firstComma + 1);

    if (firstComma != -1 && secondComma != -1) {
      currentWeather = data.substring(0, firstComma);
      String temp = data.substring(firstComma + 1, secondComma);
      currentTrainStatus = data.substring(secondComma + 1);

      lcd.clear();
      lcd.setCursor(0, 0); lcd.print(currentWeather + " " + temp + "C");
      lcd.setCursor(0, 1); lcd.print(currentTrainStatus);
    }
  }

  // --- 3. LED点灯判定（11番ピンのみ点滅） ---
  unsigned long currentMillis = millis();

  if (currentTrainStatus.indexOf("DLY") != -1) {
    // 遅延時：0.5秒（500ms）ごとに状態を反転させる
    if (currentMillis - previousMillis >= 500) {
      previousMillis = currentMillis;
      ledState = !ledState; // ON/OFFを切り替え
      
      if (ledState) {
        setLED(255, 100, 255); // オレンジ + 青点灯
      } else {
        setLED(255, 100, 0);   // オレンジのみ
      }
    }
  } 
  else if (currentWeather.indexOf("Rain") != -1) {
    setLED(0, 0, 255); // 雨なら青
  }
  else {
    // 晴れ・平常時：11番（青）を確実に0にしてオレンジ固定
    setLED(255, 100, 0); 
  }
}