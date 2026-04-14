<?php
/**
 * BaseService — thin wrapper around mysqli prepared statements.
 *
 * All concrete services extend this class and call:
 *   fetchAll()    → array of rows
 *   fetchOne()    → single row or null
 *   execute()     → affected row count
 *   insertGetId() → last insert id
 *
 * Dynamic WHERE helpers keep controllers and services free of
 * raw string interpolation that used to open SQL-injection holes.
 */
abstract class BaseService
{
    protected mysqli $conn;

    public function __construct(mysqli $conn)
    {
        $this->conn = $conn;
    }

    // ── Core prepared-statement wrappers ──────────────────────────

    /**
     * Execute a SELECT and return every row as an associative array.
     */
    protected function fetchAll(string $sql, string $types = '', array $params = []): array
    {
        $stmt = $this->prepare($sql);
        if ($types !== '') {
            $stmt->bind_param($types, ...$params);
        }
        $stmt->execute();
        $rows = [];
        $result = $stmt->get_result();
        while ($row = $result->fetch_assoc()) {
            $rows[] = $row;
        }
        $stmt->close();
        return $rows;
    }

    /**
     * Execute a SELECT and return only the first row, or null.
     */
    protected function fetchOne(string $sql, string $types = '', array $params = []): ?array
    {
        $stmt = $this->prepare($sql);
        if ($types !== '') {
            $stmt->bind_param($types, ...$params);
        }
        $stmt->execute();
        $row = $stmt->get_result()->fetch_assoc();
        $stmt->close();
        return $row ?: null;
    }

    /**
     * Execute an INSERT / UPDATE / DELETE and return affected row count.
     */
    protected function execute(string $sql, string $types = '', array $params = []): int
    {
        $stmt = $this->prepare($sql);
        if ($types !== '') {
            $stmt->bind_param($types, ...$params);
        }
        $stmt->execute();
        $affected = $stmt->affected_rows;
        $stmt->close();
        return $affected;
    }

    /**
     * Execute an INSERT and return the auto-increment id.
     */
    protected function insertGetId(string $sql, string $types = '', array $params = []): int
    {
        $stmt = $this->prepare($sql);
        if ($types !== '') {
            $stmt->bind_param($types, ...$params);
        }
        $stmt->execute();
        $id = (int) $this->conn->insert_id;
        $stmt->close();
        return $id;
    }

    // ── Transaction helpers ───────────────────────────────────────

    protected function beginTransaction(): void
    {
        $this->conn->begin_transaction();
    }

    protected function commit(): void
    {
        $this->conn->commit();
    }

    protected function rollback(): void
    {
        $this->conn->rollback();
    }

    // ── Private ──────────────────────────────────────────────────

    private function prepare(string $sql): mysqli_stmt
    {
        $stmt = $this->conn->prepare($sql);
        if ($stmt === false) {
            throw new RuntimeException('Prepare failed: ' . $this->conn->error . ' | SQL: ' . $sql);
        }
        return $stmt;
    }
}