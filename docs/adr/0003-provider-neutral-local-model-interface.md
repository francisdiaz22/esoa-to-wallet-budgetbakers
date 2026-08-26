# ADR-0003: Provider-neutral local-model interface

- Status: Accepted
- Date: 2026-08-26

## Context

Users have different operating systems and local inference runtimes. Apple
Intelligence is intended for the project owner but is not a portable dependency.

## Decision

Define classification behind a provider interface. Start with a local,
OpenAI-compatible endpoint where available and add Apple Intelligence through a
separate adapter after its integration path is validated. Providers must return
schema-valid output and expose an explicit unavailable outcome.

## Consequences

Classification and evaluation stay independent of a particular runtime. Every
provider must prove that statement data never leaves the machine.
