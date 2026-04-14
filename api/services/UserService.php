<?php
/**
 * UserService — user profiles, addresses, and admin user management.
 */
class UserService extends BaseService
{
    // ── Profile ───────────────────────────────────────────────────

    /**
     * Fetch a user's profile row and their addresses.
     */
    public function getProfile(int $uid): ?array
    {
        $user = $this->fetchOne(
            "SELECT u.user_id, u.first_name, u.last_name, u.email, u.phone,
                    u.status, r.role_name
             FROM users u
             JOIN roles r ON r.role_id = u.role_id
             WHERE u.user_id = ? LIMIT 1",
            'i',
            [$uid]
        );
        if (!$user) {
            return null;
        }

        $addresses = $this->fetchAll(
            "SELECT a.address_id, a.user_id, a.label, a.street,
                    a.barangay_id, a.municipality_id, a.is_default,
                    b.name  AS barangay,
                    m.name  AS city,
                    'Albay' AS province
             FROM addresses a
             LEFT JOIN barangays      b ON b.barangay_id    = a.barangay_id
             LEFT JOIN municipalities m ON m.municipality_id = a.municipality_id
             WHERE a.user_id = ?
             ORDER BY a.is_default DESC, a.address_id ASC",
            'i',
            [$uid]
        );

        return ['user' => $user, 'addresses' => $addresses];
    }

    /**
     * Update a customer's own profile (first/last name, phone).
     */
public function updateProfile(int $uid, string $firstName, string $lastName, string $phone): void
    {
        $phoneVal = null;
        if ($phone !== '') {
            $cleanPhone = preg_replace('/[^0-9+]/', '', $phone);
            if (!preg_match('/^(09\d{9}|\+639\d{9})$/', $cleanPhone)) {
                throw new InvalidArgumentException('Invalid phone number format. Use 09XXXXXXXXX or +639XXXXXXXXX.');
            }
            $phoneVal = $cleanPhone;
        }
        
        $this->execute(
            "UPDATE users SET first_name = ?, last_name = ?, phone = ? WHERE user_id = ?",
            'sssi',
            [$firstName, $lastName, $phoneVal, $uid]
        );
    }

    // ── Addresses ─────────────────────────────────────────────────

    /**
     * Add a new address for a user. Clears other defaults if is_default = true.
     */
    public function addAddress(
        int    $uid,
        string $label,
        string $street,
        int    $barangayId,
        int    $municipalityId,
        bool   $isDefault
    ): void {
        if ($isDefault) {
            $this->execute(
                "UPDATE addresses SET is_default = 0 WHERE user_id = ?",
                'i',
                [$uid]
            );
        }

        $this->execute(
            "INSERT INTO addresses (user_id, label, street, barangay_id, municipality_id, is_default)
             VALUES (?, ?, ?, ?, ?, ?)",
            'issiii',
            [$uid, $label, $street, $barangayId, $municipalityId, (int) $isDefault]
        );
    }

/**
     * Delete an address only if it belongs to the given user.
     */
    public function deleteAddress(int $uid, int $addressId): void
    {
        $this->execute(
            "DELETE FROM addresses WHERE address_id = ? AND user_id = ?",
            'ii',
            [$addressId, $uid]
        );
    }

    /**
     * Update an existing address that belongs to the given user.
     */
    public function updateAddress(
        int    $uid,
        int    $addressId,
        string $label,
        string $street,
        int    $barangayId,
        int    $municipalityId,
        bool   $isDefault
    ): void {
        // Verify ownership
        $row = $this->fetchOne(
            "SELECT address_id FROM addresses WHERE address_id = ? AND user_id = ? LIMIT 1",
            'ii',
            [$addressId, $uid]
        );
        if (!$row) {
            throw new RuntimeException('Address not found or access denied.');
        }

        if ($isDefault) {
            $this->execute(
                "UPDATE addresses SET is_default = 0 WHERE user_id = ?",
                'i',
                [$uid]
            );
        }

        $this->execute(
            "UPDATE addresses
             SET label = ?, street = ?, barangay_id = ?, municipality_id = ?, is_default = ?
             WHERE address_id = ? AND user_id = ?",
            'ssiiiii',
            [$label, $street, $barangayId, $municipalityId, (int) $isDefault, $addressId, $uid]
        );
    }

    // ── Admin: user list ──────────────────────────────────────────

    /**
     * Return all users filtered by optional search, role, and status.
     */
    public function getUsers(string $search, string $role, string $status): array
    {
        $conditions = ['1=1'];
        $types      = '';
        $params     = [];

        if ($search !== '') {
            $conditions[] = "(u.first_name LIKE ? OR u.last_name LIKE ? OR u.email LIKE ?)";
            $like = "%$search%";
            $types .= 'sss';
            $params[] = $like;
            $params[] = $like;
            $params[] = $like;
        }
        if ($role !== '') {
            $conditions[] = 'r.role_name = ?';
            $types .= 's';
            $params[] = $role;
        }
        if ($status !== '') {
            $conditions[] = 'u.status = ?';
            $types .= 's';
            $params[] = $status;
        }

        $where = implode(' AND ', $conditions);

        return $this->fetchAll(
            "SELECT u.user_id, u.first_name, u.last_name, u.email, u.phone,
                    u.status, u.created_at, r.role_name,
                    (SELECT COUNT(*) FROM orders WHERE user_id = u.user_id) AS order_count
             FROM users u
             JOIN roles r ON r.role_id = u.role_id
             WHERE $where
             ORDER BY u.created_at DESC",
            $types,
            $params
        );
    }

    /**
     * Update the status of any user account (active / suspended / blocked).
     */
    public function updateUserStatus(int $uid, string $status): void
    {
        $allowed = ['active', 'suspended', 'blocked'];
        if (!in_array($status, $allowed, true)) {
            throw new InvalidArgumentException('Invalid status value.');
        }
        $this->execute(
            "UPDATE users SET status = ? WHERE user_id = ?",
            'si',
            [$status, $uid]
        );
    }

    /**
     * Create or update a staff / rider user account.
     *
     * @return int  The user_id of the created/updated record.
     */
    public function saveUser(
        int    $uid,
        string $firstName,
        string $lastName,
        string $email,
        string $phone,
        string $roleName,
        string $password
    ): int {
        $allowedRoles = ['Customer', 'Super Admin', 'Fulfillment Staff', 'Delivery Rider'];
        if (!in_array($roleName, $allowedRoles, true)) {
            throw new InvalidArgumentException('Invalid role.');
        }

        $roleRow = $this->fetchOne(
            "SELECT role_id FROM roles WHERE role_name = ? LIMIT 1",
            's',
            [$roleName]
        );
        if (!$roleRow) {
            throw new RuntimeException('Role not found.');
        }
        $roleId    = (int) $roleRow['role_id'];
        $phoneVal  = $phone !== '' ? $phone : null;

        if ($uid > 0) {
            // Update existing user
            $this->execute(
                "UPDATE users SET first_name = ?, last_name = ?, email = ?,
                 phone = ?, role_id = ? WHERE user_id = ?",
                'sssiii',
                [$firstName, $lastName, $email, $phoneVal, $roleId, $uid]
            );
            if ($password !== '') {
                $hash = password_hash($password, PASSWORD_BCRYPT);
                $this->execute(
                    "UPDATE users SET password_hash = ? WHERE user_id = ?",
                    'si',
                    [$hash, $uid]
                );
            }
            return $uid;
        }

        // Create new user
        if (strlen($password) < 8) {
            throw new InvalidArgumentException('Password must be at least 8 characters.');
        }
        $hash = password_hash($password, PASSWORD_BCRYPT);
        $newId = $this->insertGetId(
            "INSERT INTO users (role_id, first_name, last_name, email, password_hash, phone, status)
             VALUES (?, ?, ?, ?, ?, ?, 'active')",
            'isssss',
            [$roleId, $firstName, $lastName, $email, $hash, $phoneVal]
        );
        if ($roleName === 'Customer') {
            $this->execute(
                "INSERT INTO carts (user_id) VALUES (?)",
                'i',
                [$newId]
            );
        }
        return $newId;
    }

    /**
     * Return all active Delivery Riders.
     */
    public function getRiders(): array
    {
        return $this->fetchAll(
            "SELECT u.user_id, u.first_name, u.last_name, u.email, u.phone, u.status
             FROM users u
             JOIN roles r ON r.role_id = u.role_id
             WHERE r.role_name = 'Delivery Rider' AND u.status = 'active'
             ORDER BY u.first_name ASC"
        );
    }

    /**
     * Update a rider's phone and/or password after verifying the current password.
     */
public function updateRiderProfile(int $riderId, string $newPhone, string $currentPass, string $newPass): void
    {
        $updates = [];
        $types   = '';
        $params  = [];

        if ($newPhone !== '') {
            // Strict PH mobile format — 09XXXXXXXXX or +639XXXXXXXXX
            $cleanPhone = preg_replace('/[^0-9+]/', '', $newPhone);
            if (!preg_match('/^(09\d{9}|\+639\d{9})$/', $cleanPhone)) {
                throw new InvalidArgumentException('Invalid phone number format. Use 09XXXXXXXXX or +639XXXXXXXXX.');
            }
            $updates[] = 'phone = ?';
            $types    .= 's';
            $params[]  = $cleanPhone;
        }

        if ($newPass !== '') {
            if (strlen($newPass) < 8) {
                throw new InvalidArgumentException('New password must be at least 8 characters.');
            }
            $cur = $this->fetchOne(
                "SELECT password_hash FROM users WHERE user_id = ? LIMIT 1",
                'i',
                [$riderId]
            );
            if (!$cur || !password_verify($currentPass, $cur['password_hash'])) {
                throw new RuntimeException('Current password is incorrect.');
            }
            $hash      = password_hash($newPass, PASSWORD_BCRYPT);
            $updates[] = 'password_hash = ?';
            $types    .= 's';
            $params[]  = $hash;
        }

        if (empty($updates)) {
            throw new InvalidArgumentException('No changes to save.');
        }

$params[] = $riderId;
        $types   .= 'i';
        $set      = implode(', ', $updates);
        $this->execute("UPDATE users SET $set WHERE user_id = ?", $types, $params);
    }

    /**
     * Change a customer's password after verifying the current one.
     * Unlike updateRiderProfile(), this method has no phone-format side-effects.
     */
    public function changeCustomerPassword(int $uid, string $currentPass, string $newPass): void
    {
        if (strlen($newPass) < 8) {
            throw new InvalidArgumentException('New password must be at least 8 characters.');
        }
        $row = $this->fetchOne(
            "SELECT password_hash FROM users WHERE user_id = ? LIMIT 1",
            'i',
            [$uid]
        );
        if (!$row || !password_verify($currentPass, $row['password_hash'])) {
            throw new RuntimeException('Current password is incorrect.');
        }
        $hash = password_hash($newPass, PASSWORD_BCRYPT);
        $this->execute(
            "UPDATE users SET password_hash = ? WHERE user_id = ?",
            'si',
            [$hash, $uid]
        );
    }

    public function checkUserActive(int $uid): void
    {
        $row = $this->fetchOne(
            "SELECT status FROM users WHERE user_id = ? LIMIT 1",
            'i',
            [$uid]
        );
        if (!$row) {
            throw new RuntimeException('Account not found.');
        }
        if (in_array($row['status'], ['suspended', 'blocked'], true)) {
            throw new RuntimeException('Your account has been suspended. Please contact support.');
        }
    }
}