<?php
declare(strict_types=1);

function fc_report_bounds(string $period, ?DateTimeImmutable $now = null): array {
    $now = ($now ?? new DateTimeImmutable('now', new DateTimeZone('Asia/Taipei')))->setTimezone(new DateTimeZone('Asia/Taipei'));
    $start = $now->setTime(0, 0);
    if ($period === 'week') {
        $start = $start->modify('-' . ((int)$start->format('N') - 1) . ' days');
    } elseif ($period !== 'day') {
        throw new InvalidArgumentException('不支援的報告範圍。');
    }
    return [$start, $now];
}

function fc_report_metrics(PDO $pdo, int $userId, DateTimeImmutable $start, DateTimeImmutable $end): array {
    $stmt = $pdo->prepare("SELECT COUNT(*) AS sessions, COALESCE(SUM(minutes), 0) AS minutes,
        COALESCE(SUM(calories), 0) AS calories,
        COUNT(DISTINCT (date AT TIME ZONE 'Asia/Taipei')::date) AS active_days
        FROM workouts WHERE user_id = ? AND date >= ? AND date <= ?");
    $stmt->execute([$userId, $start->format(DateTimeInterface::ATOM), $end->format(DateTimeInterface::ATOM)]);
    return array_map('intval', $stmt->fetch());
}

function fc_build_report(PDO $pdo, int $userId, string $period, ?DateTimeImmutable $now = null): array {
    [$start, $end] = fc_report_bounds($period, $now);
    $ownTransaction = !$pdo->inTransaction();
    if ($ownTransaction) {
        $pdo->beginTransaction();
        $pdo->exec('SET TRANSACTION ISOLATION LEVEL REPEATABLE READ, READ ONLY');
    }
    try {
        $totals = fc_report_metrics($pdo, $userId, $start, $end);
        $offset = $period === 'week' ? '-7 days' : '-1 day';
        $previous = fc_report_metrics($pdo, $userId, $start->modify($offset), $end->modify($offset));
        $stmt = $pdo->prepare('SELECT type, COUNT(*) AS sessions, SUM(minutes) AS minutes, SUM(calories) AS calories
            FROM workouts WHERE user_id = ? AND date >= ? AND date <= ? GROUP BY type ORDER BY SUM(minutes) DESC, type');
        $stmt->execute([$userId, $start->format(DateTimeInterface::ATOM), $end->format(DateTimeInterface::ATOM)]);
        $sports = array_map(static function (array $row): array {
            return ['type' => $row['type'], 'sessions' => (int)$row['sessions'], 'minutes' => (int)$row['minutes'], 'calories' => (int)$row['calories']];
        }, $stmt->fetchAll());
        if ($ownTransaction) $pdo->commit();
    } catch (Throwable $e) {
        if ($ownTransaction && $pdo->inTransaction()) $pdo->rollBack();
        throw $e;
    }
    $report = [
        'period' => $period, 'title' => $period === 'week' ? '個人週報' : '當日運動分析',
        'start' => $start->format('Y-m-d'), 'end' => $end->format('Y-m-d H:i'), 'timezone' => 'Asia/Taipei',
        'totals' => $totals, 'sports' => $sports, 'previous' => $previous,
        'comparison_label' => $period === 'week' ? '上週同期' : '昨日同期',
        'minutes_change' => $totals['minutes'] - $previous['minutes'],
    ];
    $report['text'] = fc_report_text($report);
    return $report;
}

function fc_report_text(array $report): string {
    $t = $report['totals'];
    $text = $report['title'] . "\n" . $report['start'] . ' 至 ' . $report['end'] . "（台北時間）\n"
        . "已記錄 {$t['sessions']} 筆・{$t['active_days']} 天\n運動 {$t['minutes']} 分鐘・估計消耗 {$t['calories']} kcal";
    if (!$t['sessions']) $text .= "\n此期間尚無運動紀錄，不代表您沒有運動。";
    foreach ($report['sports'] as $sport) $text .= "\n{$sport['type']}：{$sport['minutes']} 分鐘／{$sport['sessions']} 筆";
    $change = $report['minutes_change'];
    $text .= "\n較{$report['comparison_label']}" . ($change >= 0 ? '增加 ' : '減少 ') . abs($change) . ' 分鐘。';
    return $text . "\n資料來源：已儲存的運動紀錄；熱量為估計值。";
}
