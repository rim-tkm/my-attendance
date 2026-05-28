-- Slack KPI 通知まわりの「既送信」フラグを一括リセットする（運用復旧・テスト用）
-- 適用前にバックアップ・スキーマ確認をすること。
--
-- 1. 終了打刻後 KPI 未入力アラートの送信枠
DELETE FROM public.kpi_missing_after_punch_alert_sent;

-- 2. KPI 保存直後の生産性低下アラートの送信枠
DELETE FROM public.kpi_productivity_alert_sent;

-- 3. KPI 行に残る「未入力 Slack 済み」の記録（列がある場合のみ）
UPDATE public.kpis SET kpi_missing_slack_notified_at = NULL WHERE kpi_missing_slack_notified_at IS NOT NULL;
