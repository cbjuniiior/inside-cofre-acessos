# Ícone do aplicativo (atalho / .exe / instalador)

Coloque aqui os arquivos de ÍCONE do app. O electron-builder os usa
automaticamente ao gerar o instalador.

- Windows: `icon.ico` — 256×256 (idealmente multi-resolução: 16/32/48/256)
- Mac:     `icon.icns` (ou um `icon.png` 512×512 que o builder converte)
- Linux:   `icon.png` — 512×512

Nomes EXATOS esperados pelo electron-builder: `icon.ico`, `icon.icns`, `icon.png`.

Dica: se você só tem um PNG quadrado de alta resolução (512×512+), pode soltar
como `icon.png` que eu gero o `.ico` a partir dele e configuro o resto.
