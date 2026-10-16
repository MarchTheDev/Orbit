; The setup file and the setup window both use this icon.
;
; It is defined here, next to the file, because the stock installer icon is
; what NSIS keeps when this is left unset. The same file is used for the
; uninstaller so the two icons are the same size, which NSIS requires.
!define MUI_ICON "${__FILEDIR__}/installer.ico"
!define MUI_UNICON "${__FILEDIR__}/installer.ico"
