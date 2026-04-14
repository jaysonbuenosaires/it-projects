<?php
/**
 * AuthService — login and role-based access verification.
 *
 * Used by every API file:
 *   AuthService::login()      → verifies credentials, returns sanitised user row
 *   AuthService::verifyRole() → validates that a user_id belongs to an allowed role
 */
class AuthService extends BaseService
{
    /**
     * Attempt a login.
     *
     * @param string   $email
     * @param string   $plainPassword
     * @param string[] $allowedRoles   Leave empty to allow any active user.
     *
     * @return array  ['success' => bool, 'user' => array|null, 'message' => string]
     */
    public function login(string $email, string $plainPassword, array $allowedRoles = []): array
    {
        if ($email === '' || $plainPassword === '') {
            return ['success' => false, 'user' => null, 'message' => 'Email and password are required.'];
        }

        $row = $this->fetchOne(
            "SELECT u.user_id, u.first_name, u.last_name, u.email,
                    u.password_hash, u.status, r.role_name
             FROM users u
             JOIN roles r ON r.role_id = u.role_id
             WHERE u.email = ? LIMIT 1",
            's',
            [$email]
        );

        if (!$row || $row['status'] !== 'active' || !password_verify($plainPassword, $row['password_hash'])) {
            return ['success' => false, 'user' => null, 'message' => 'Invalid email or password.'];
        }

        if (!empty($allowedRoles) && !in_array($row['role_name'], $allowedRoles, true)) {
            return ['success' => false, 'user' => null, 'message' => 'Access denied for this portal.'];
        }

        unset($row['password_hash']);
        return ['success' => true, 'user' => $row, 'message' => 'Login successful.'];
    }

    /**
     * Verify that a user ID exists, is active, and holds one of the required roles.
     *
     * @param int      $userId
     * @param string[] $allowedRoles
     *
     * @return array|null  The user row (user_id, role_name) on success, null on failure.
     */
    public function verifyRole(int $userId, array $allowedRoles): ?array
    {
        if ($userId <= 0) {
            return null;
        }

        $row = $this->fetchOne(
            "SELECT u.user_id, r.role_name
             FROM users u
             JOIN roles r ON r.role_id = u.role_id
             WHERE u.user_id = ? AND u.status = 'active' LIMIT 1",
            'i',
            [$userId]
        );

        if (!$row || !in_array($row['role_name'], $allowedRoles, true)) {
            return null;
        }

        return $row;
    }
}