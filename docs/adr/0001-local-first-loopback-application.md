# ADR-0001: Local-first loopback application

- Status: Accepted
- Date: 2026-08-26

## Context

Statements and Wallet history are sensitive, while OCR engines and local models
need filesystem and process access that browser code cannot safely provide.

## Decision

Use a browser UI with a Node.js service bound only to `127.0.0.1`. Process
financial inputs locally. Do not add hosted application processing in v1.

## Consequences

The design remains cross-platform and gives adapters controlled access to local
capabilities. The service must enforce loopback binding and protect local HTTP
endpoints against untrusted origins as those endpoints are introduced.
