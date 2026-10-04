# CS2 Chat Translator

Prosta strona, która na bieżąco śledzi czat z Counter-Strike 2 i pokazuje tłumaczenie obok oryginału.

## Jak używać

1. W Steamie: CS2 → Właściwości → Opcje uruchamiania → dodaj `-condebug`.
2. Otwórz `index.html` w Chrome lub Edge (lokalnie albo przez GitHub Pages).
3. Kliknij **Wybierz console.log** i wskaż plik
   `...\Steam\steamapps\common\Counter-Strike Global Offensive\game\csgo\console.log`.
4. Graj. Nowe wiadomości z czatu pojawiają się w lewym oknie, tłumaczenie w prawym.

Przycisk **Tryb demo** pokazuje przykładowe wiadomości bez uruchamiania gry.

## Jak to działa

- Odczyt pliku przez File System Access API (tylko przeglądarki Chromium). Plik nie opuszcza komputera.
- Strona co 500 ms sprawdza rozmiar pliku i czyta tylko dopisane linie.
- Linie czatu wyłapuje regex `CHAT_RE` w `app.js`. Jeśli format w Twoim logu jest inny, popraw go tam.
- Tłumaczenie: darmowe API MyMemory (bez klucza, limit ok. 5000 znaków dziennie).

## Dalsze kroki

- Podmiana tłumacza na DeepL lub LLM przez własny backend (żeby nie trzymać klucza w kodzie).
- Pomijanie wiadomości, które już są w języku docelowym.
- Lokalny serwer + WebSocket, żeby oglądać tłumaczenia na telefonie.
