@echo off
set AIONUI_E2E_TEST=1
set AIONUI_E2E_USER_DATA_DIR=D:\视频Agent\.runtime\installed-first-boot-data
set AIONUI_H3_BUNDLE_ROOT=D:\视频Agent\.runtime\h3-offline-bundle
start "AionUi smoke" /b "D:\视频Agent\.runtime\installed-smoke\AionUi.exe"
