#!/bin/bash

# Cognito MFA Migration Patterns - 自動デプロイスクリプト
# =======================================================

set -e

# 色付きログ用の関数
log_info() {
    echo -e "\033[1;34m[INFO]\033[0m $1"
}

log_success() {
    echo -e "\033[1;32m[SUCCESS]\033[0m $1"
}

log_error() {
    echo -e "\033[1;31m[ERROR]\033[0m $1"
}

log_warning() {
    echo -e "\033[1;33m[WARNING]\033[0m $1"
}

# スクリプトの使用方法
usage() {
    echo "Usage: $0 [OPTIONS]"
    echo "Options:"
    echo "  -d, --deploy        Deploy all stacks"
    echo "  -c, --cleanup       Destroy all stacks"
    echo "  -t, --test          Run deployment tests"
    echo "  -h, --help          Show this help message"
    echo ""
    echo "Examples:"
    echo "  $0 --deploy         # Deploy all resources"
    echo "  $0 --test           # Run tests after deployment"
    echo "  $0 --cleanup        # Clean up all resources"
}

# 前提条件の確認
check_prerequisites() {
    log_info "前提条件を確認しています..."
    
    # Node.jsの確認
    if ! command -v node &> /dev/null; then
        log_error "Node.js がインストールされていません"
        exit 1
    fi
    
    # npm の確認
    if ! command -v npm &> /dev/null; then
        log_error "npm がインストールされていません"
        exit 1
    fi
    
    # AWS CLI の確認
    if ! command -v aws &> /dev/null; then
        log_error "AWS CLI がインストールされていません"
        exit 1
    fi
    
    # CDK の確認
    if ! command -v cdk &> /dev/null; then
        log_error "AWS CDK がインストールされていません"
        log_info "以下のコマンドでインストールしてください:"
        log_info "npm install -g aws-cdk"
        exit 1
    fi
    
    # AWS 認証情報の確認
    if ! aws sts get-caller-identity &> /dev/null; then
        log_error "AWS 認証情報が設定されていません"
        log_info "以下のコマンドで設定してください:"
        log_info "aws configure"
        exit 1
    fi
    
    log_success "前提条件の確認完了"
}

# 依存関係のインストール
install_dependencies() {
    log_info "依存関係をインストールしています..."
    
    # メインプロジェクトの依存関係
    log_info "メインプロジェクトの依存関係をインストール中..."
    npm install
    
    # CDK プロジェクトの依存関係
    log_info "CDK プロジェクトの依存関係をインストール中..."
    cd cdk
    npm install
    cd ..
    
    log_success "依存関係のインストール完了"
}

# CDK ブートストラップ
bootstrap_cdk() {
    log_info "CDK をブートストラップしています..."
    
    cd cdk
    
    # 既にブートストラップされているかチェック
    if aws s3 ls s3://cdk-hnb659fds-assets-$(aws sts get-caller-identity --query Account --output text)-$(aws configure get region) &> /dev/null; then
        log_info "CDK は既にブートストラップされています"
    else
        cdk bootstrap
        log_success "CDK ブートストラップ完了"
    fi
    
    cd ..
}

# デプロイ実行
deploy_stacks() {
    log_info "AWS リソースをデプロイしています..."
    
    cd cdk
    
    # 変更内容の確認
    log_info "変更内容を確認中..."
    cdk diff
    
    # デプロイ実行
    log_info "全スタックをデプロイ中..."
    cdk deploy --all --require-approval never
    
    cd ..
    
    log_success "デプロイ完了"
}

# デプロイ結果の表示
show_deployment_results() {
    log_info "デプロイ結果を取得中..."
    
    cd cdk
    
    # スタックの出力を取得
    log_info "=== デプロイ結果 ==="
    echo ""
    
    # Cognito スタックの出力
    log_info "📱 Cognito User Pools:"
    aws cloudformation describe-stacks \
        --stack-name CognitoMfaMigrationStack \
        --query 'Stacks[0].Outputs[?OutputKey==`LegacyUserPoolId`].OutputValue' \
        --output text 2>/dev/null | while read value; do
        echo "  Legacy User Pool ID: $value"
    done
    
    aws cloudformation describe-stacks \
        --stack-name CognitoMfaMigrationStack \
        --query 'Stacks[0].Outputs[?OutputKey==`NewUserPoolId`].OutputValue' \
        --output text 2>/dev/null | while read value; do
        echo "  New User Pool ID: $value"
    done
    
    # API Gateway URL
    log_info "🌐 API Gateway:"
    aws cloudformation describe-stacks \
        --stack-name ApiStack \
        --query 'Stacks[0].Outputs[?OutputKey==`ApiGatewayUrl`].OutputValue' \
        --output text 2>/dev/null | while read value; do
        echo "  API URL: $value"
    done
    
    # CloudWatch Dashboard
    log_info "📊 モニタリング:"
    aws cloudformation describe-stacks \
        --stack-name MonitoringStack \
        --query 'Stacks[0].Outputs[?OutputKey==`DashboardUrl`].OutputValue' \
        --output text 2>/dev/null | while read value; do
        echo "  Dashboard URL: $value"
    done
    
    echo ""
    log_success "デプロイ情報の確認完了"
    
    cd ..
}

# テスト実行
run_tests() {
    log_info "デプロイメントテストを実行中..."
    
    # API Gateway URL の取得
    cd cdk
    API_URL=$(aws cloudformation describe-stacks \
        --stack-name ApiStack \
        --query 'Stacks[0].Outputs[?OutputKey==`ApiGatewayUrl`].OutputValue' \
        --output text 2>/dev/null)
    cd ..
    
    if [ -z "$API_URL" ]; then
        log_error "API Gateway URL が取得できませんでした"
        return 1
    fi
    
    log_info "API URL: $API_URL"
    
    # API ヘルスチェック
    log_info "API ヘルスチェック実行中..."
    if curl -s "${API_URL}docs" | grep -q "title"; then
        log_success "API ヘルスチェック成功"
    else
        log_error "API ヘルスチェック失敗"
        return 1
    fi
    
    # Migration Status チェック
    log_info "Migration Status チェック実行中..."
    if curl -s "${API_URL}public/migration-status" | grep -q "legacyPoolUsers"; then
        log_success "Migration Status チェック成功"
    else
        log_error "Migration Status チェック失敗"
        return 1
    fi
    
    # Test Scenarios チェック
    log_info "Test Scenarios チェック実行中..."
    if curl -s "${API_URL}public/test-scenarios" | grep -q "scenarios"; then
        log_success "Test Scenarios チェック成功"
    else
        log_error "Test Scenarios チェック失敗"
        return 1
    fi
    
    log_success "全テスト完了"
}

# クリーンアップ
cleanup_stacks() {
    log_warning "すべてのリソースを削除します"
    read -p "本当に削除しますか？ (y/N): " -n 1 -r
    echo
    
    if [[ $REPLY =~ ^[Yy]$ ]]; then
        log_info "リソースを削除中..."
        
        cd cdk
        cdk destroy --all --force
        cd ..
        
        log_success "クリーンアップ完了"
    else
        log_info "クリーンアップがキャンセルされました"
    fi
}

# メイン処理
main() {
    echo "================================================"
    echo "🚀 Cognito MFA Migration Patterns - Deployment"
    echo "================================================"
    echo ""
    
    case "$1" in
        -d|--deploy)
            check_prerequisites
            install_dependencies
            bootstrap_cdk
            deploy_stacks
            show_deployment_results
            echo ""
            log_success "デプロイが完了しました！"
            log_info "テストを実行するには: $0 --test"
            log_info "クリーンアップするには: $0 --cleanup"
            ;;
        -t|--test)
            run_tests
            ;;
        -c|--cleanup)
            cleanup_stacks
            ;;
        -h|--help)
            usage
            ;;
        *)
            log_error "無効なオプション: $1"
            usage
            exit 1
            ;;
    esac
}

# 引数チェック
if [ $# -eq 0 ]; then
    usage
    exit 1
fi

# メイン処理の実行
main "$@"