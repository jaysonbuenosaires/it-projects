<?php
/**
 * Response — centralised, standardised JSON output.
 *
 * Every controller calls Response::ok() or Response::error() and exits.
 * The helper always sets the HTTP status code and terminates execution,
 * so controllers never need bare echo + exit.
 */
class Response
{
    /**
     * Emit a successful JSON response.
     *
     * Pass any extra keys (data, message, user, total, pages, …) inside $payload.
     * 'success' => true is always injected first so the contract never breaks.
     *
     * @param array $payload  Arbitrary key→value pairs merged into the response body.
     * @param int   $code     HTTP status code (default 200).
     */
    public static function ok(array $payload = [], int $code = 200): void
    {
        http_response_code($code);
        echo json_encode(array_merge(['success' => true], $payload));
        exit;
    }

    /**
     * Emit a failure JSON response.
     *
     * @param string $message  Human-readable error description.
     * @param int    $code     HTTP status code (default 400).
     */
    public static function error(string $message, int $code = 400): void
    {
        http_response_code($code);
        echo json_encode(['success' => false, 'message' => $message]);
        exit;
    }
}