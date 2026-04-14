<?php
/**
 * NotificationService — send, fetch, and mark-read notifications.
 */
class NotificationService extends BaseService
{
    /**
     * Insert a notification row for one user.
     */
    public function send(int $userId, string $message, string $type): void
    {
        $this->execute(
            "INSERT INTO notifications (user_id, message, type) VALUES (?, ?, ?)",
            'iss',
            [$userId, $message, $type]
        );
    }

    /**
     * Return the last 50 notifications for a user, unread first.
     */
    public function getForUser(int $uid): array
    {
        $notifs = $this->fetchAll(
            "SELECT n.notification_id, n.message, n.type, n.is_read, n.created_at,
                    o.order_id AS related_order_id
             FROM notifications n
             LEFT JOIN orders o
               ON n.message LIKE CONCAT('%', o.order_number, '%')
             WHERE n.user_id = ?
             ORDER BY n.is_read ASC, n.created_at DESC
             LIMIT 50",
            'i',
            [$uid]
        );

        $unread = (int) ($this->fetchOne(
            "SELECT COUNT(*) AS n FROM notifications WHERE user_id = ? AND is_read = 0",
            'i',
            [$uid]
        )['n'] ?? 0);

        return ['notifications' => $notifs, 'unread_count' => $unread];
    }

    /**
     * Mark one or all notifications as read for a user.
     *
     * @param int $notifId  Pass 0 to mark all.
     */
    public function markRead(int $uid, int $notifId): void
    {
        if ($notifId > 0) {
            $this->execute(
                "UPDATE notifications SET is_read = 1 WHERE notification_id = ? AND user_id = ?",
                'ii',
                [$notifId, $uid]
            );
        } else {
            $this->execute(
                "UPDATE notifications SET is_read = 1 WHERE user_id = ?",
                'i',
                [$uid]
            );
        }
    }

    /**
     * Mark a list of notification IDs as read (fulfillment staff use).
     *
     * @param int[] $ids
     */
    public function markReadByIds(array $ids): void
    {
        if (empty($ids)) {
            return;
        }
        // Safe: values are cast to int, never user strings
        $placeholders = implode(',', array_fill(0, count($ids), '?'));
        $types        = str_repeat('i', count($ids));
        $intIds       = array_map('intval', $ids);
        $this->execute(
            "UPDATE notifications SET is_read = 1 WHERE notification_id IN ($placeholders)",
            $types,
            $intIds
        );
    }

    /**
     * Fetch recent unread cancellation notifications (for fulfillment staff poll).
     */
    public function pollCancellations(): array
    {
        $notifs = $this->fetchAll(
            "SELECT n.notification_id, n.message, n.type, n.created_at,
                    o.order_number, o.order_id
             FROM notifications n
             LEFT JOIN orders o ON o.order_id = (
                 SELECT order_id FROM orders
                 WHERE order_number = SUBSTRING_INDEX(SUBSTRING_INDEX(n.message, 'order ', -1), ' ', 1)
                 LIMIT 1
             )
             WHERE n.type IN ('cancelled') AND n.is_read = 0
             ORDER BY n.created_at DESC
             LIMIT 20"
        );

        if (!empty($notifs)) {
            return ['data' => $notifs, 'type' => 'notifications'];
        }

        // Fallback: recent cancellation logs
        $cancels = $this->fetchAll(
            "SELECT cl.log_id, cl.order_id, cl.reason, cl.created_at,
                    o.order_number, o.status
             FROM cancellation_logs cl
             JOIN orders o ON o.order_id = cl.order_id
             WHERE cl.created_at >= DATE_SUB(NOW(), INTERVAL 2 HOUR)
             ORDER BY cl.created_at DESC LIMIT 10"
        );

        return ['data' => $cancels, 'type' => 'cancellations'];
    }
}