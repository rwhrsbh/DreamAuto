#!/bin/bash
# Function to detect OS
get_os() {
    case "$(uname -s)" in
        Linux*)     echo 'linux';;
        Darwin*)    echo 'macos';;
        MINGW*)     echo 'windows';;
        *)          echo 'unknown';;
    esac
}



# Function to setup CORS for Linux
setup_linux_cors() {
    echo "Setting up CORS for Linux..."
    # Create systemd override directory
    sudo mkdir -p /etc/systemd/system/ollama.service.d/
    # Create override file
    cat << EOF | sudo tee /etc/systemd/system/ollama.service.d/override.conf
[Service]
Environment="OLLAMA_ORIGINS=*"
EOF
    # Reload systemd and restart ollama
    sudo systemctl daemon-reload
    sudo systemctl restart ollama
    echo "Linux CORS setup complete!"
}

# Function to setup CORS for macOS
setup_macos_cors() {
    echo "Setting up CORS for macOS..."
    # Create or modify the launchd plist
    cat << EOF > ~/Library/LaunchAgents/com.ollama.cors.plist
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
    <key>Label</key>
    <string>com.ollama.cors</string>
    <key>ProgramArguments</key>
    <array>
        <string>/usr/local/bin/ollama</string>
        <string>serve</string>
    </array>
    <key>EnvironmentVariables</key>
    <dict>
        <key>OLLAMA_ORIGINS</key>
        <string>*</string>
    </dict>
    <key>RunAtLoad</key>
    <true/>
    <key>KeepAlive</key>
    <true/>
</dict>
</plist>
EOF
    # Load the launchd service
    launchctl unload ~/Library/LaunchAgents/com.ollama.cors.plist 2>/dev/null || true
    launchctl load ~/Library/LaunchAgents/com.ollama.cors.plist
    echo "macOS CORS setup complete!"
}

# Main script
OS=$(get_os)
case $OS in
    'linux')
        setup_linux_cors
        ;;
    'macos')
        setup_macos_cors
        ;;
    'windows')
        echo "Use Batch script for Windows!"
        ;;
    *)
        echo "Unsupported operating system"
        exit 1
        ;;
esac