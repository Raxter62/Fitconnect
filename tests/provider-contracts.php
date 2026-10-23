<?php
declare(strict_types=1);
if (PHP_SAPI !== 'cli') { http_response_code(404); exit; }
// Run only with the curl execution functions disabled; no external request is made.
$responses = [];
$options = [];
$mockStatus = 200;
$mockBody = '{"id":"test-email"}';
if (!function_exists('curl_exec')) {
function curl_setopt($handle, int $option, $value): bool {
    $GLOBALS['options'][spl_object_id($handle)][$option] = $value;
    return true;
}
function curl_setopt_array($handle, array $values): bool {
    foreach ($values as $key => $value) curl_setopt($handle, $key, $value);
    return true;
}
function curl_exec($handle) {
    $GLOBALS['responses'][] = $GLOBALS['options'][spl_object_id($handle)] ?? [];
    return $GLOBALS['mockBody'];
}
function curl_getinfo($handle, int $option = 0) { return $GLOBALS['mockStatus']; }
} else {
    fwrite(STDERR, "This test requires disabled curl execution functions.\n");
    exit(1);
}
require_once __DIR__ . '/../config.php';
require_once __DIR__ . '/../mail.php';
require_once __DIR__ . '/../auth.php';
require_once __DIR__ . '/../LLM/coach.php';
function check_contract(bool $ok, string $message): void {
    if (!$ok) throw new RuntimeException($message);
}
$user = $pdo->query("SELECT id, email FROM users WHERE email = 'athlete-b@example.test'")->fetch();
check_contract((bool)$user, 'Test user missing');
check_contract(fc_send_account_link($pdo, $user, 'reset'), 'Email submission failed');
$mail = json_decode($responses[0][CURLOPT_POSTFIELDS], true);
preg_match('/#auth=reset&token=([a-f0-9]{64})/', html_entity_decode($mail['html']), $match);
check_contract(isset($match[1]), 'Email link missing');
$hash = hash('sha256', $match[1]);
$stmt = $pdo->prepare('SELECT token_hash, expires_at FROM account_tokens WHERE token_hash = ?');
$stmt->execute([$hash]);
check_contract((bool)$stmt->fetch(), 'Only hash should identify stored token');
check_contract(fc_send_account_link($pdo, $user, 'reset') && count($responses) === 1, 'Cooldown should avoid duplicate email');
check_contract(fc_consume_account_token($pdo, 'reset', $match[1], 'ProviderTest123!'), 'Mailed token should reset password');
check_contract(!fc_consume_account_token($pdo, 'reset', $match[1], 'AnotherPassword123!'), 'Mailed token should be single use');
$mockBody = json_encode(['candidates' => [['finishReason' => 'STOP', 'content' => ['parts' => [['text' => json_encode(['advice' => ['依紀錄與身體感受逐步安排運動。'], 'question' => ''])]]]]]]);
$result = askCoachFromDb($pdo, (int)$user['id'], '運動建議', [['role' => 'user', 'text' => '我想持續運動']], 'week');
check_contract(isset($result['report']['totals']) && strpos($result['response'], '逐步') !== false, 'Gemini response should include real report');
$request = end($responses);
$payload = json_decode($request[CURLOPT_POSTFIELDS], true);
check_contract(count($payload['contents']) === 2, 'Server context should be included');
$serialized = json_encode($payload, JSON_UNESCAPED_UNICODE);
check_contract(strpos($serialized, $user['email']) === false && strpos($serialized, 'password_hash') === false, 'Personal identity should not be sent');
check_contract(in_array('x-goog-api-key: test-gemini-key', $request[CURLOPT_HTTPHEADER], true), 'Gemini must receive server-side key header');
check_contract(strpos($serialized, '保留同理心') !== false, 'Prompt should keep a warm conversational tone');
foreach ([400, 401, 403, 404, 429, 500] as $mockStatus) {
$mockBody = '{"error":{"message":"DO_NOT_EXPOSE_UPSTREAM_DETAIL"}}';
try {
    askCoachFromDb($pdo, (int)$user['id'], '運動建議');
    throw new LogicException('Rate error should not succeed');
} catch (RuntimeException $e) {
    check_contract($e->getMessage() === FC_COACH_UNAVAILABLE, 'Provider errors must use the public fallback');
}
}
echo "Email link creation/cooldown/consumption and Gemini request/response contracts passed without external calls.\n";
