import { expect, test } from '@playwright/test';

/**
 * US-034 AC4 — critical UI flow coverage against the real API + PostgreSQL with
 * the deterministic local mock AI provider. Runs only under `E2E_REAL_API=1`
 * (see `pnpm test:e2e:real`); `global-setup.ts` migrates + resets the test DB
 * first so first-run setup is visible.
 *
 * Covered: first-run setup, logout/login, KB create/select, entity CRUD,
 * claim CRUD, search + views, AI proposal review (mock provider), rule
 * authoring + reasoning run, portable JSON export/import.
 */
test.describe.configure({ mode: 'serial', timeout: 120_000 });

test('V1 critical UI flows (real API, mock AI provider)', async ({ page }) => {
  const suffix = Date.now();
  const email = `admin-${suffix}@example.test`;
  const password = 'password-12345';
  const kbName = `V1 KB ${suffix}`;

  // 1. First-run setup.
  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'First-run setup' })).toBeVisible();
  await page.getByLabel('Email').fill(email);
  await page.getByLabel('Password').fill(password);
  await page.getByTestId('setup-submit').click();
  await expect(page.getByTestId('current-user')).toContainText(email);

  // 2. Logout / login.
  await page.getByTestId('logout').click();
  await expect(page.getByRole('heading', { name: 'Sign in' })).toBeVisible();
  await page.getByLabel('Email').fill(email);
  await page.getByLabel('Password').fill(password);
  await page.getByTestId('login-submit').click();
  await expect(page.getByTestId('current-user')).toContainText(email);

  // AI policy: allow local-only AI on all three layers so the mock extractor
  // becomes available (strictest-wins; a fresh KB resolves to OFF otherwise).
  await page.getByTestId('ai-policy-server-mode').selectOption('local_only');
  await page.getByTestId('ai-policy-server-save').click();
  await page.getByTestId('ai-policy-user-mode').selectOption('local_only');
  await page.getByTestId('ai-policy-user-save').click();

  // 3. KB create + select.
  await page.getByTestId('kb-name').fill(kbName);
  await page.getByTestId('kb-description').fill('V1 verification KB');
  await page.getByTestId('kb-create-submit').click();
  await page.getByRole('button', { name: new RegExp(kbName) }).click();
  await expect(page.getByTestId('entities')).toBeVisible();

  // KB-layer AI policy local-only.
  await expect(page.getByTestId('kb-ai-policy-mode')).toBeVisible();
  await page.getByTestId('kb-ai-policy-mode').selectOption('local_only');
  await page.getByTestId('kb-ai-policy-save').click();

  // 4. Entity CRUD.
  await page.getByTestId('entity-type').selectOption('Person');
  await page.getByTestId('entity-name').fill('Ada Lovelace');
  await page.getByTestId('entity-aliases').fill('Ada');
  await page.getByTestId('entity-tags').fill('math, history');
  await page.getByTestId('entity-submit').click();
  await expect(page.getByTestId('entities-list')).toContainText('Ada Lovelace');

  await page.getByTestId('entity-type').selectOption('Concept');
  await page.getByTestId('entity-name').fill('Analytical Engine');
  await page.getByTestId('entity-tags').fill('computing');
  await page.getByTestId('entity-submit').click();
  await expect(page.getByTestId('entities-list')).toContainText('Analytical Engine');

  const adaRow = page
    .getByTestId('entities-list')
    .locator('li', { hasText: 'Ada Lovelace' })
    .first();
  await adaRow.getByRole('button', { name: 'Edit' }).click();
  await page.getByTestId('entity-description').fill('Edited in V1 e2e');
  await page.getByTestId('entity-aliases').fill('Ada, Countess Lovelace');
  await page.getByTestId('entity-submit').click();
  await expect(page.getByTestId('entities-list')).toContainText('Countess Lovelace');

  // Per-KB sibling components fetch their data once per kb.id and don't live-sync,
  // so reload + reselect the KB before the Claims form reads the entity list.
  await page.reload();
  await page.getByRole('button', { name: new RegExp(kbName) }).click();
  await expect(page.getByTestId('claims')).toBeVisible();

  // 5. Claim CRUD (two entity arguments).
  await page.getByTestId('claim-predicate').fill('inspired');
  await page.getByTestId('claim-description').fill('Ada inspired computing.');
  await page.getByTestId('claim-confidence').fill('0.9');
  await page.getByTestId('claim-valid-start').fill('1843-01-01');
  await page.getByTestId('claim-arg-role-0').fill('subject');
  await page.getByTestId('claim-arg-entity-0').selectOption({ label: 'Ada Lovelace (Person)' });
  await page.getByTestId('claim-add-argument').click();
  await page.getByTestId('claim-arg-role-1').fill('object');
  await page
    .getByTestId('claim-arg-entity-1')
    .selectOption({ label: 'Analytical Engine (Concept)' });
  await page.getByTestId('claim-submit').click();
  await expect(page.getByTestId('claims-list')).toContainText('inspired');

  // 6. Search + views.
  await page.getByTestId('search-query').fill('Ada');
  await page.getByTestId('search-submit').click();
  await expect(page.getByTestId('search-results')).toContainText('Ada Lovelace');

  await page.getByTestId('view-tab-table').click();
  await expect(page.getByTestId('graph-views')).toContainText('Ada Lovelace');
  await page.getByTestId('view-tab-timeline').click();
  await expect(page.getByTestId('graph-views')).toBeVisible();

  // 7. AI proposal review with the deterministic mock provider.
  await page.getByTestId('capture-kind').selectOption('note');
  await page.getByTestId('capture-title').fill('Mock extraction note');
  await page
    .getByTestId('capture-content')
    .fill('Grace Hopper worked with COBOL and Ada Lovelace inspired computing.');
  await page.getByTestId('capture-submit').click();
  await expect(page.getByTestId('capture-demo-label')).toBeVisible();
  const firstProposal = page.getByTestId('proposals-list').locator('li').first();
  await expect(firstProposal).toBeVisible();
  await firstProposal.getByRole('button', { name: 'Accept all' }).click();
  await expect(firstProposal).toHaveCount(0);

  // 8. Reasoning: author, enable, run a restricted Datalog rule.
  await page.getByTestId('rules-author-name').fill('Tag people');
  await page
    .getByTestId('rules-author-text')
    .fill('tagged(?p, "person") <- entity(?p, "Person", ?n).');
  await page.getByTestId('rules-author-validate').click();
  await expect(page.getByTestId('rules-author-valid')).toBeVisible();
  await page.getByTestId('rules-author-submit').click();

  const ruleRow = page
    .getByTestId('rules-installed')
    .locator('li', { hasText: 'Tag people' })
    .first();
  await ruleRow.getByRole('button', { name: 'Enable' }).click();
  const runButton = ruleRow.getByRole('button', { name: 'Run' });
  await expect(runButton).toBeEnabled();
  await runButton.click();
  await expect(page.getByTestId('rules-run-result')).toBeVisible();
  await expect(page.getByTestId('rules-run-status')).toContainText('completed');

  // 9. Portable JSON export + import (creates a new KB).
  const href = await page.getByTestId('kb-export-json').getAttribute('href');
  expect(href).toBeTruthy();
  const exportResponse = await page.request.get(href!);
  expect(exportResponse.ok()).toBeTruthy();

  await page.getByTestId('kb-import-file').setInputFiles({
    name: 'jotmind-export.json',
    mimeType: 'application/json',
    buffer: await exportResponse.body(),
  });
  await expect(page.getByTestId('kb-import-result')).toContainText(
    'Imported into new Knowledge Base',
  );
});
