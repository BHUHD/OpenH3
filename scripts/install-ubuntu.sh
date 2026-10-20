#!/usr/bin/env bash
# ============================================================================
# OpenH3 — Ubuntu / Debian 一鍵自動化安裝腳本
# ============================================================================
# 功能：
#   1. 自動偵測系統架構 (amd64 / arm64)
#   2. 從 GitHub Release 下載指定版本的 .deb 套件（預設 latest）
#   3. 安裝 .deb + 自動修復依賴
#   4. 安裝 Xvfb 等 headless 運行所需套件
#   5. 建立服務管理腳本 (/opt/OpenH3/start-openh3.sh)
#   6. (可選) 建立 systemd service
#   7. (可選) 建立桌面捷徑
#
# 用法：
#   curl -fsSL https://raw.githubusercontent.com/pigq/OpenH3/main/scripts/install-ubuntu.sh | bash
#   # 或指定版本：
#   OPENH3_VERSION=1.8.25 bash install-ubuntu.sh
#   # 僅安裝桌面版（跳過 headless 設定）：
#   OPENH3_MODE=desktop bash install-ubuntu.sh
# ============================================================================

set -euo pipefail

# ─── 顏色定義 ───────────────────────────────────────────────────────────────
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
CYAN='\033[0;36m'
BOLD='\033[1m'
NC='\033[0m' # No Color

# ─── 輔助函式 ───────────────────────────────────────────────────────────────
info()    { echo -e "${BLUE}[INFO]${NC} $*"; }
success() { echo -e "${GREEN}[✓]${NC} $*"; }
warn()    { echo -e "${YELLOW}[!]${NC} $*"; }
error()   { echo -e "${RED}[✗]${NC} $*" >&2; }
die()     { error "$*"; exit 1; }

banner() {
    echo -e "${CYAN}${BOLD}"
    echo "  ╔══════════════════════════════════════════════╗"
    echo "  ║          OpenH3 Installer for Ubuntu         ║"
    echo "  ╚══════════════════════════════════════════════╝"
    echo -e "${NC}"
}

# ─── 前置檢查 ───────────────────────────────────────────────────────────────
check_prerequisites() {
    # 必須是 Linux
    [[ "$(uname -s)" == "Linux" ]] || die "此腳本僅支援 Linux 系統"

    # 必須有 apt (Debian/Ubuntu 系列)
    command -v apt-get &>/dev/null || die "此腳本需要 apt-get (Debian/Ubuntu 系列)"

    # 建議以 root 或 sudo 執行
    if [[ $EUID -ne 0 ]]; then
        if command -v sudo &>/dev/null; then
            SUDO="sudo"
            warn "非 root 使用者，將使用 sudo 執行安裝"
        else
            die "請以 root 身份執行，或安裝 sudo"
        fi
    else
        SUDO=""
    fi
}

# ─── 偵測架構 ───────────────────────────────────────────────────────────────
detect_arch() {
    local machine
    machine="$(uname -m)"
    case "$machine" in
        x86_64|amd64)
            DEB_ARCH="amd64"
            RELEASE_ARCH="x64"
            ;;
        aarch64|arm64)
            DEB_ARCH="arm64"
            RELEASE_ARCH="arm64"
            ;;
        *)
            die "不支援的架構: $machine（僅支援 x86_64 / aarch64）"
            ;;
    esac
    info "偵測到系統架構: ${BOLD}$machine${NC} → 套件架構: ${BOLD}$DEB_ARCH${NC}"
}

# ─── 取得版本號 ──────────────────────────────────────────────────────────────
resolve_version() {
    if [[ -n "${OPENH3_VERSION:-${AIONUI_VERSION:-}}" ]]; then
        VERSION="${OPENH3_VERSION:-$AIONUI_VERSION}"
        info "使用指定版本: ${BOLD}v$VERSION${NC}"
    else
        info "正在查詢最新版本..."
        # 透過 GitHub API 取得 latest release tag
        if command -v curl &>/dev/null; then
            VERSION=$(curl -fsSL "https://api.github.com/repos/pigq/OpenH3/releases/latest" \
                | grep '"tag_name"' | head -1 | sed 's/.*"v\([^"]*\)".*/\1/')
        elif command -v wget &>/dev/null; then
            VERSION=$(wget -qO- "https://api.github.com/repos/pigq/OpenH3/releases/latest" \
                | grep '"tag_name"' | head -1 | sed 's/.*"v\([^"]*\)".*/\1/')
        else
            die "需要 curl 或 wget 來下載，請先安裝: sudo apt-get install -y curl"
        fi

        if [[ -z "$VERSION" ]]; then
            die "無法取得最新版本號，請手動指定: OPENH3_VERSION=1.8.25 bash $0"
        fi
        info "最新版本: ${BOLD}v$VERSION${NC}"
    fi

    # electron-builder names the x86_64 artifact `x64`, while Debian metadata
    # uses `amd64`. Keep the package architecture for dpkg, but resolve the
    # release asset using the builder name (with an amd64 fallback below).
    DEB_FILENAME="OpenH3-${VERSION}-linux-${RELEASE_ARCH}.deb"
    DOWNLOAD_URL="https://github.com/pigq/OpenH3/releases/download/v${VERSION}/${DEB_FILENAME}"
}

# ─── 下載 .deb 套件 ──────────────────────────────────────────────────────────
download_deb() {
    local tmpdir
    tmpdir="$(mktemp -d)"
    DEB_PATH="${tmpdir}/${DEB_FILENAME}"

    info "下載 ${BOLD}$DEB_FILENAME${NC} ..."
    info "網址: $DOWNLOAD_URL"

    if command -v curl &>/dev/null; then
        if ! curl -fSL --progress-bar -o "$DEB_PATH" "$DOWNLOAD_URL"; then
            # Older OpenH3 releases used the Debian architecture spelling.
            if [[ "$RELEASE_ARCH" == "x64" ]]; then
                DEB_FILENAME="OpenH3-${VERSION}-linux-amd64.deb"
                DOWNLOAD_URL="https://github.com/pigq/OpenH3/releases/download/v${VERSION}/${DEB_FILENAME}"
                curl -fSL --progress-bar -o "$DEB_PATH" "$DOWNLOAD_URL" || die "下載失敗"
            else
                die "下載失敗"
            fi
        fi
    elif command -v wget &>/dev/null; then
        if ! wget --show-progress -q -O "$DEB_PATH" "$DOWNLOAD_URL"; then
            if [[ "$RELEASE_ARCH" == "x64" ]]; then
                DEB_FILENAME="OpenH3-${VERSION}-linux-amd64.deb"
                DOWNLOAD_URL="https://github.com/pigq/OpenH3/releases/download/v${VERSION}/${DEB_FILENAME}"
                wget --show-progress -q -O "$DEB_PATH" "$DOWNLOAD_URL" || die "下載失敗"
            else
                die "下載失敗"
            fi
        fi
    else
        die "需要 curl 或 wget 下載"
    fi

    local size
    size=$(du -h "$DEB_PATH" | cut -f1)
    success "下載完成 ($size)"
}

# ─── 安裝 .deb + 修復依賴 ────────────────────────────────────────────────────
install_deb() {
    info "安裝 OpenH3 .deb 套件..."

    # dpkg 安裝（可能會缺依賴）
    $SUDO dpkg -i "$DEB_PATH" 2>/dev/null || true

    # 自動修復缺失的依賴
    info "修復依賴套件..."
    $SUDO apt-get install -f -y

    success "OpenH3 v${VERSION} 安裝完成"

    # 驗證安裝
    if command -v OpenH3 &>/dev/null || [[ -x /usr/bin/OpenH3 ]]; then
        success "OpenH3 已安裝至 $(which OpenH3 2>/dev/null || echo '/usr/bin/OpenH3')"
    else
        warn "安裝可能不完整，找不到 OpenH3 執行檔"
    fi

    # 清理暫存
    rm -rf "$(dirname "$DEB_PATH")"
}

# ─── 安裝 Headless 依賴 ──────────────────────────────────────────────────────
install_headless_deps() {
    info "安裝 headless 運行所需套件 (Xvfb 等)..."

    $SUDO apt-get update -qq
    $SUDO apt-get install -y --no-install-recommends \
        xvfb \
        libxkbcommon-x11-0 \
        libgtk-3-0 \
        libnotify4 \
        libnss3 \
        libxss1 \
        libasound2 \
        libgbm1 \
        libicu-dev \
        2>/dev/null || warn "部分套件可能已安裝或不可用"

    success "Headless 依賴安裝完成"
}

# ─── 建立服務管理腳本 ─────────────────────────────────────────────────────────
create_service_script() {
    local script_dir="/opt/OpenH3"
    local script_path="${script_dir}/start-openh3.sh"

    info "建立服務管理腳本: $script_path"
    $SUDO mkdir -p "$script_dir"

    $SUDO tee "$script_path" > /dev/null << 'SCRIPT_EOF'
#!/bin/bash
# ============================================================================
# OpenH3 WebUI Headless 服務管理腳本
# 用法: ./start-openh3.sh [start|stop|restart|status|logs]
# ============================================================================

PIDFILE="/var/run/openh3.pid"
LEGACY_PIDFILE="/var/run/aionui.pid"
LOGFILE="/var/log/openh3.log"
WORKDIR="${OPENH3_WORKDIR:-${AIONUI_WORKDIR:-$HOME}}"

legacy_process_is_tracked() {
    [ -f "$LEGACY_PIDFILE" ] || return 1
    local pid command_line
    pid=$(cat "$LEGACY_PIDFILE")
    [[ "$pid" =~ ^[0-9]+$ ]] || return 1
    kill -0 "$pid" 2>/dev/null || return 1
    command_line=$(ps -p "$pid" -o args= 2>/dev/null || true)
    [[ "$command_line" == *"AionUi --webui"* ]]
}

stop_legacy() {
    [ -f "$LEGACY_PIDFILE" ] || return 1
    local pid
    pid=$(cat "$LEGACY_PIDFILE")
    if [[ "$pid" =~ ^[0-9]+$ ]] && kill -0 "$pid" 2>/dev/null; then
        if ! legacy_process_is_tracked; then
            echo "⚠️  保留旧 PID 文件：PID $pid 不像 AionUi WebUI 进程"
            return 1
        fi
        echo "🛑 正在停止舊版 AionUi WebUI (PID: $pid)..."
        kill "$pid" 2>/dev/null || true
        sleep 2
        kill -0 "$pid" 2>/dev/null && kill -9 "$pid" 2>/dev/null || true
    fi
    pkill -f "AionUi --webui" 2>/dev/null || true
    rm -f "$LEGACY_PIDFILE"
}

start() {
    if [ -f "$PIDFILE" ] && kill -0 "$(cat "$PIDFILE")" 2>/dev/null; then
        echo "⚡ OpenH3 已在執行中 (PID: $(cat "$PIDFILE"))"
        return 1
    fi

    if [ -f "$LEGACY_PIDFILE" ]; then
        stop_legacy || return 1
    fi

    echo "🚀 正在啟動 OpenH3 WebUI..."
    cd "$WORKDIR" || exit 1

    nohup xvfb-run --auto-servernum --server-args="-screen 0 1920x1080x24" \
        /usr/bin/OpenH3 --webui --remote --no-sandbox \
        > "$LOGFILE" 2>&1 &

    echo $! > "$PIDFILE"
    sleep 3

    if kill -0 "$(cat "$PIDFILE")" 2>/dev/null; then
        echo "✅ OpenH3 啟動成功 (PID: $(cat "$PIDFILE"))"
        local ip
        ip=$(hostname -I 2>/dev/null | awk '{print $1}')
        echo "🌐 WebUI: http://${ip:-localhost}:25808"
    else
        echo "❌ OpenH3 啟動失敗，請查看日誌: $LOGFILE"
        rm -f "$PIDFILE"
        return 1
    fi
}

stop() {
    local stopped=0
    if [ -f "$PIDFILE" ] && kill -0 "$(cat "$PIDFILE")" 2>/dev/null; then
        local pid
        pid=$(cat "$PIDFILE")
        echo "🛑 正在停止 OpenH3 (PID: $pid)..."
        kill "$pid" 2>/dev/null || true
        sleep 2
        kill -0 "$pid" 2>/dev/null && kill -9 "$pid" 2>/dev/null || true
        pkill -f "OpenH3 --webui" 2>/dev/null || true
        rm -f "$PIDFILE"
        stopped=1
    elif [ -f "$PIDFILE" ]; then
        rm -f "$PIDFILE"
    fi

    if [ -f "$LEGACY_PIDFILE" ]; then
        stop_legacy || return 1
        stopped=1
    fi

    if [ "$stopped" -eq 0 ]; then
        echo "⚠️  OpenH3 未在執行"
        return 1
    fi
    echo "✅ OpenH3 已停止"
}

restart() {
    stop 2>/dev/null
    sleep 1
    start
}

status() {
    if [ -f "$PIDFILE" ] && kill -0 "$(cat "$PIDFILE")" 2>/dev/null; then
        echo "✅ OpenH3 執行中 (PID: $(cat "$PIDFILE"))"
        ss -tlnp 2>/dev/null | grep 25808 || netstat -tlnp 2>/dev/null | grep 25808 || true
    elif legacy_process_is_tracked; then
        echo "⚠️  舊版 AionUi WebUI 仍在執行 (PID: $(cat "$LEGACY_PIDFILE"))；執行 stop 後再啟動 OpenH3"
    else
        echo "⚠️  OpenH3 未在執行"
        rm -f "$PIDFILE" 2>/dev/null
    fi
}

logs() {
    if [ -f "$LOGFILE" ]; then
        tail -f "$LOGFILE"
    else
        echo "日誌檔案不存在: $LOGFILE"
    fi
}

case "${1:-}" in
    start)   start ;;
    stop)    stop ;;
    restart) restart ;;
    status)  status ;;
    logs)    logs ;;
    "")
        echo "用法: $0 {start|stop|restart|status|logs}"
        echo ""
        echo "環境變數:"
        echo "  OPENH3_WORKDIR  - OpenH3 工作目錄 (預設: \$HOME)"
        ;;
    *)
        echo "用法: $0 {start|stop|restart|status|logs}"
        exit 1
        ;;
esac
SCRIPT_EOF

    $SUDO chmod +x "$script_path"
    success "服務管理腳本已建立: $script_path"

    # Preserve the old management-script path when upgrading an existing install.
    local legacy_script_dir="/opt/AionUi"
    local legacy_script_path="${legacy_script_dir}/start-aionui.sh"
    if [[ -d "$legacy_script_dir" && ! -L "$legacy_script_dir" ]]; then
        if [[ ! -L "$legacy_script_path" ]]; then
            $SUDO tee "$legacy_script_path" > /dev/null << 'LEGACY_SCRIPT_EOF'
#!/usr/bin/env bash
exec /opt/OpenH3/start-openh3.sh "$@"
LEGACY_SCRIPT_EOF
            $SUDO chmod +x "$legacy_script_path"
            info "舊管理腳本路徑已轉接至 OpenH3"
        else
            warn "保留既有符號連結: $legacy_script_path"
        fi
    fi
}

# ─── 建立 systemd service (可選) ─────────────────────────────────────────────
create_systemd_service() {
    # 若系統不支援 systemd 則跳過
    if ! command -v systemctl &>/dev/null; then
        info "系統不支援 systemd，跳過 service 建立"
        return
    fi

    local service_path="/etc/systemd/system/openh3.service"
    local legacy_service_path="/etc/systemd/system/aionui.service"
    local legacy_service_was_enabled=0
    local legacy_service_was_active=0
    local legacy_alias_allowed=1

    if [[ -L "$legacy_service_path" ]]; then
        local legacy_service_target
        legacy_service_target="$(readlink "$legacy_service_path")"
        if [[ "$legacy_service_target" != "openh3.service" && "$legacy_service_target" != "$service_path" ]]; then
            legacy_alias_allowed=0
            warn "保留非 OpenH3 的既有服務連結: $legacy_service_path"
        fi
    elif [[ -f "$legacy_service_path" ]]; then
        if grep -Eq '^ExecStart=.*(/usr/bin/AionUi|AionUi --webui)' "$legacy_service_path"; then
            if $SUDO systemctl is-enabled --quiet aionui.service; then
                legacy_service_was_enabled=1
            fi
            if $SUDO systemctl is-active --quiet aionui.service; then
                legacy_service_was_active=1
            fi

            info "遷移舊 aionui.service 至 openh3.service"
            $SUDO systemctl stop aionui.service >/dev/null 2>&1 || true
            $SUDO systemctl disable aionui.service >/dev/null 2>&1 || true
            $SUDO rm -f "$legacy_service_path"
        else
            legacy_alias_allowed=0
            warn "保留非本安裝程式建立的既有服務: $legacy_service_path"
        fi
    fi

    info "建立 systemd 服務: $service_path"

    $SUDO tee "$service_path" > /dev/null << 'SERVICE_EOF'
[Unit]
Description=OpenH3 AI Agent Desktop App (WebUI Mode)
Documentation=https://github.com/pigq/OpenH3
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
User=root
WorkingDirectory=/root
ExecStart=/usr/bin/xvfb-run --auto-servernum --server-args="-screen 0 1920x1080x24" /usr/bin/OpenH3 --webui --remote --no-sandbox
Restart=on-failure
RestartSec=10
StandardOutput=journal
StandardError=journal

# 安全性設定
NoNewPrivileges=false
ProtectSystem=false

[Install]
WantedBy=multi-user.target
SERVICE_EOF

    if [[ "$legacy_alias_allowed" -eq 1 ]]; then
        $SUDO ln -sfn "openh3.service" "$legacy_service_path"
    fi

    $SUDO systemctl daemon-reload
    if [[ "$legacy_service_was_enabled" -eq 1 ]]; then
        $SUDO systemctl enable openh3.service
    fi
    if [[ "$legacy_service_was_active" -eq 1 ]]; then
        $SUDO systemctl start openh3.service
    fi
    success "systemd 服務已建立"
    info "使用方式:"
    echo "    sudo systemctl start openh3     # 啟動"
    echo "    sudo systemctl stop openh3      # 停止"
    echo "    sudo systemctl enable openh3    # 開機自動啟動"
    echo "    sudo systemctl status openh3    # 查看狀態"
    echo "    journalctl -u openh3 -f         # 查看日誌"
}

# ─── 建立桌面捷徑 ─────────────────────────────────────────────────────────────
create_desktop_entry() {
    local desktop_dir="${HOME}/.local/share/applications"
    local desktop_file="${desktop_dir}/openh3.desktop"

    mkdir -p "$desktop_dir"

    cat > "$desktop_file" << 'DESKTOP_EOF'
[Desktop Entry]
Name=OpenH3
Comment=AI Agent Cowork Platform
Exec=/usr/bin/OpenH3 --no-sandbox %U
Icon=OpenH3
Terminal=false
Type=Application
Categories=Office;Utility;Development;
# Keep the legacy scheme registered so existing links continue to open, while
# making OpenH3 the canonical protocol for new installations.
MimeType=x-scheme-handler/openh3;x-scheme-handler/aionui;
StartupWMClass=OpenH3
DESKTOP_EOF

    # Keep the historical desktop-file ID as a hidden launcher for upgrades
    # and applications that still refer to aionui.desktop.
    local legacy_desktop_file="${desktop_dir}/aionui.desktop"
    cat > "$legacy_desktop_file" << 'LEGACY_DESKTOP_EOF'
[Desktop Entry]
Name=AionUi (Legacy)
Comment=Legacy OpenH3 launcher
Exec=/usr/bin/OpenH3 --no-sandbox %U
Icon=OpenH3
Terminal=false
Type=Application
NoDisplay=true
MimeType=x-scheme-handler/aionui;
StartupWMClass=OpenH3
LEGACY_DESKTOP_EOF

    if command -v update-desktop-database &>/dev/null; then
        update-desktop-database "$desktop_dir" >/dev/null 2>&1 || true
    fi
    if command -v xdg-mime &>/dev/null; then
        xdg-mime default openh3.desktop x-scheme-handler/openh3 >/dev/null 2>&1 || true
        xdg-mime default openh3.desktop x-scheme-handler/aionui >/dev/null 2>&1 || true
    fi

    success "桌面捷徑已建立: $desktop_file"
}

# ─── 顯示安裝摘要 ─────────────────────────────────────────────────────────────
print_summary() {
    echo ""
    echo -e "${GREEN}${BOLD}══════════════════════════════════════════════════${NC}"
    echo -e "${GREEN}${BOLD}  🎉 OpenH3 v${VERSION} 安裝完成！${NC}"
    echo -e "${GREEN}${BOLD}══════════════════════════════════════════════════${NC}"
    echo ""
    echo -e "  ${BOLD}📍 執行檔位置:${NC}  /usr/bin/OpenH3"
    echo -e "  ${BOLD}📍 管理腳本:${NC}    /opt/OpenH3/start-openh3.sh"
    echo ""

    if [[ "${MODE}" == "headless" ]]; then
        echo -e "  ${BOLD}🖥️  Headless 模式使用方式:${NC}"
        echo ""
        echo "    # 使用管理腳本"
        echo "    /opt/OpenH3/start-openh3.sh start"
        echo "    /opt/OpenH3/start-openh3.sh status"
        echo "    /opt/OpenH3/start-openh3.sh stop"
        echo ""
        if command -v systemctl &>/dev/null; then
            echo "    # 或使用 systemd"
            echo "    sudo systemctl start openh3"
            echo "    sudo systemctl enable openh3  # 開機自啟"
            echo ""
        fi
        echo "    # WebUI 預設監聽 http://localhost:25808"
        echo ""
    else
        echo -e "  ${BOLD}🖥️  桌面模式使用方式:${NC}"
        echo ""
        echo "    # 直接啟動（桌面環境）"
        echo "    OpenH3 --no-sandbox"
        echo ""
        echo "    # 或從應用程式選單尋找 OpenH3"
        echo ""
    fi

    echo -e "  ${BOLD}📖 文件:${NC}  https://github.com/pigq/OpenH3"
    echo -e "  ${BOLD}🐛 回報:${NC}  https://github.com/pigq/OpenH3/issues"
    echo ""

    if [[ "${MODE}" == "headless" ]]; then
        echo -e "  ${YELLOW}💡 提示:${NC}"
        echo "     • 設定工作目錄: export OPENH3_WORKDIR=/path/to/workspace"
        echo "     • 遠端存取方式: SSH 隧道 / ngrok / 直接開放 25808 端口"
        echo "     • 詳細指南: docs/guides/deploy-server.md"
        echo ""
    fi
}

# ─── 主流程 ───────────────────────────────────────────────────────────────────
main() {
    banner

    # 安裝模式：headless (預設) 或 desktop
    MODE="${OPENH3_MODE:-${AIONUI_MODE:-headless}}"
    info "安裝模式: ${BOLD}$MODE${NC}"

    # Step 1: 前置檢查
    check_prerequisites

    # Step 2: 偵測架構
    detect_arch

    # Step 3: 取得版本號
    resolve_version

    # Step 4: 下載
    download_deb

    # Step 5: 安裝
    install_deb

    # Step 6: 根據模式安裝額外元件
    if [[ "$MODE" == "headless" ]]; then
        install_headless_deps
        create_service_script
        create_systemd_service
    fi

    # Step 7: 桌面捷徑（兩種模式都建立）
    create_desktop_entry

    # 完成！
    print_summary
}

# 執行
main "$@"
