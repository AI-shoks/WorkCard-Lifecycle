import { Buffer } from 'node:buffer';
import process from 'node:process';

const chunks = [];
for await (const chunk of process.stdin) chunks.push(chunk);

const rawPlan = Buffer.concat(chunks).toString('utf8');
if (!rawPlan.trim()) throw new Error('Ожидался JSON plan в stdin.');

const plan = JSON.parse(rawPlan);
const violations = [];
const forbiddenValueKeys = new Set([
  'password',
  'password_wo',
  'root_password',
  'root_password_wo',
  'secret_data',
  'secret_data_wo',
]);

function inspectValues(value, path = 'planned_values') {
  if (Array.isArray(value)) {
    value.forEach((entry, index) => inspectValues(entry, `${path}[${index}]`));
    return;
  }
  if (value === null || typeof value !== 'object') return;

  for (const [key, child] of Object.entries(value)) {
    const childPath = `${path}.${key}`;
    if (forbiddenValueKeys.has(key) && child !== null) {
      violations.push(`${childPath} содержит materialized secret value`);
    }
    inspectValues(child, childPath);
  }
}

inspectValues(plan.planned_values?.outputs, 'planned_values.outputs');

for (const variableName of ['staging_secret_values', 'production_secret_values']) {
  const plannedVariable = plan.variables?.[variableName];
  if (plannedVariable && plannedVariable.value !== null) {
    violations.push(`variables.${variableName} сохранена в plan вместо ephemeral omission`);
  }
}

if (/postgres(?:ql)?:\/\/[^\s:@/]+:[^\s@/]+@/i.test(rawPlan)) {
  violations.push('plan содержит PostgreSQL URL с inline credential');
}

if (/review-(?:staging|production)-(?:owner|runtime|session)-/i.test(rawPlan)) {
  violations.push('ephemeral review marker materialized в plan');
}

const resourceCounts = new Map();
const resourcesByAddress = new Map();
function collectResources(module) {
  for (const resource of module?.resources ?? []) {
    resourceCounts.set(resource.type, (resourceCounts.get(resource.type) ?? 0) + 1);
    resourcesByAddress.set(resource.address, resource);
    inspectValues(resource.values, `${resource.address}.values`);
  }
  for (const child of module?.child_modules ?? []) collectResources(child);
}
collectResources(plan.planned_values?.root_module);

const expectedExactCounts = new Map([
  ['google_project', 3],
  ['google_artifact_registry_repository', 1],
  ['google_service_account', 13],
  ['google_iam_workload_identity_pool', 2],
  ['google_iam_workload_identity_pool_provider', 2],
  ['google_project_iam_custom_role', 1],
  ['google_project_iam_member', 20],
  ['google_secret_manager_secret_iam_member', 16],
  ['google_service_account_iam_member', 13],
  ['google_artifact_registry_repository_iam_member', 4],
  ['google_cloud_run_v2_service', 2],
  ['google_cloud_run_v2_service_iam_member', 3],
  ['google_cloud_run_v2_job', 8],
  ['google_cloud_run_v2_job_iam_member', 8],
  ['google_sql_database_instance', 2],
  ['google_sql_database', 2],
  ['google_secret_manager_secret', 8],
  ['google_secret_manager_secret_version', 8],
  ['google_billing_budget', 3],
]);

for (const [type, expected] of expectedExactCounts) {
  const actual = resourceCounts.get(type) ?? 0;
  if (actual !== expected) violations.push(`${type}: ожидалось ${expected}, найдено ${actual}`);
}

if (plan.variables?.teardown_mode?.value !== false) {
  violations.push('release review plan обязан фиксировать teardown_mode=false');
}

if ((resourceCounts.get('google_service_account_key') ?? 0) > 0) {
  violations.push('service account JSON key не должен присутствовать в release plan');
}

function requireResource(address) {
  const resource = resourcesByAddress.get(address);
  if (!resource) violations.push(`${address} отсутствует в release plan`);
  return resource?.values;
}

function resourcesOfType(type) {
  return [...resourcesByAddress.values()].filter((resource) => resource.type === type);
}

function assertExactAddresses(type, expectedAddresses) {
  const actual = new Set(resourcesOfType(type).map((resource) => resource.address));
  const expected = new Set(expectedAddresses);
  for (const address of expected) {
    if (!actual.has(address)) violations.push(`${type}: обязательная связь ${address} отсутствует`);
  }
  for (const address of actual) {
    if (!expected.has(address)) violations.push(`${type}: неожиданная связь ${address}`);
  }
}

function assertExactStrings(actual, expected, label) {
  const normalizedActual = [...actual].sort();
  const normalizedExpected = [...expected].sort();
  if (JSON.stringify(normalizedActual) !== JSON.stringify(normalizedExpected)) {
    violations.push(
      `${label}: ожидалось ${normalizedExpected.join(', ')}, найдено ${normalizedActual.join(', ')}`,
    );
  }
}

function requireRoleAndMember(address, role, member) {
  const resource = requireResource(address);
  if (!resource) return;
  if (resource.role !== role) violations.push(`${address} имеет неожиданную роль ${resource.role}`);
  if (resource.member !== member) violations.push(`${address} имеет неожиданного member`);
}

const releaseDeployer = requireResource('google_service_account.release_deployer');
const artifactPublisher = requireResource('google_service_account.artifact_publisher');
const smokeRunner = requireResource('google_service_account.smoke_runner');
const deployerMember = releaseDeployer?.email
  ? `serviceAccount:${releaseDeployer.email}`
  : undefined;
const publisherMember = artifactPublisher?.email
  ? `serviceAccount:${artifactPublisher.email}`
  : undefined;
const smokeMember = smokeRunner?.email ? `serviceAccount:${smokeRunner.email}` : undefined;
if (!deployerMember || !publisherMember || !smokeMember) {
  violations.push('release service account emails должны быть известны на этапе plan');
}

const environments = ['staging', 'production'];
const workloads = ['app', 'migrate', 'reset', 'seed', 'verify'];
const jobNames = ['migrate', 'reset', 'seed', 'verify'];
const deployerRoles = [
  'roles/cloudsql.viewer',
  'roles/logging.viewer',
  'roles/monitoring.viewer',
  'roles/run.developer',
  'roles/secretmanager.viewer',
];
const secretAccessKeys = [
  'app/database-url',
  'app/session-signing-secret',
  'migrate/app-database-password',
  'migrate/migration-database-url',
  'reset/migration-database-url',
  'seed/app-database-password',
  'seed/migration-database-url',
  'verify/database-url',
];

assertExactAddresses(
  'google_project_iam_member',
  environments.flatMap((environment) => [
    ...deployerRoles.map(
      (role) => `google_project_iam_member.release_deployer["${environment}/${role}"]`,
    ),
    ...workloads.map(
      (workload) =>
        `module.${environment}.google_project_iam_member.cloud_sql_client["${workload}"]`,
    ),
  ]),
);

for (const environment of environments) {
  for (const role of deployerRoles) {
    const address = `google_project_iam_member.release_deployer["${environment}/${role}"]`;
    requireRoleAndMember(address, role, deployerMember);
  }
  for (const workload of workloads) {
    const address =
      `module.${environment}.google_project_iam_member.cloud_sql_client["${workload}"]`;
    const values = requireResource(address);
    if (!values) continue;
    if (values.role !== 'roles/cloudsql.client') {
      violations.push(`${address} имеет неожиданную роль ${values.role}`);
    }
    if (!values.member?.includes(`work-card-${workload}@`)) {
      violations.push(`${address} выдан не выделенному workload service account`);
    }
  }
}

assertExactAddresses(
  'google_secret_manager_secret_iam_member',
  environments.flatMap((environment) =>
    secretAccessKeys.map(
      (key) =>
        `module.${environment}.google_secret_manager_secret_iam_member.accessor["${key}"]`,
    ),
  ),
);
for (const resource of resourcesOfType('google_secret_manager_secret_iam_member')) {
  if (resource.values.role !== 'roles/secretmanager.secretAccessor') {
    violations.push(`${resource.address} имеет неожиданную роль ${resource.values.role}`);
  }
  const workload = resource.address.match(/accessor\["([^/]+)\//)?.[1];
  if (!workload || !resource.values.member?.includes(`work-card-${workload}@`)) {
    violations.push(`${resource.address} выдан не ожидаемому workload service account`);
  }
  if (resource.values.member === deployerMember) {
    violations.push('release deployer не должен иметь прямой secretAccessor binding');
  }
}

assertExactAddresses('google_service_account_iam_member', [
  'google_service_account_iam_member.artifact_publisher_workload_identity',
  'google_service_account_iam_member.release_deployer_workload_identity',
  'google_service_account_iam_member.smoke_runner_workload_identity',
  ...environments.flatMap((environment) =>
    workloads.map(
      (workload) =>
        `module.${environment}.google_service_account_iam_member.release_deployer_act_as["${workload}"]`,
    ),
  ),
]);
for (const environment of environments) {
  for (const workload of workloads) {
    requireRoleAndMember(
      `module.${environment}.google_service_account_iam_member.release_deployer_act_as["${workload}"]`,
      'roles/iam.serviceAccountUser',
      deployerMember,
    );
  }
}

assertExactAddresses(
  'google_cloud_run_v2_job_iam_member',
  environments.flatMap((environment) =>
    jobNames.map(
      (jobName) =>
        `module.${environment}.google_cloud_run_v2_job_iam_member.release_execute["${jobName}"]`,
    ),
  ),
);
for (const environment of environments) {
  for (const jobName of jobNames) {
    requireRoleAndMember(
      `module.${environment}.google_cloud_run_v2_job_iam_member.release_execute["${jobName}"]`,
      'roles/run.jobsExecutor',
      deployerMember,
    );
  }
}

assertExactAddresses('google_artifact_registry_repository_iam_member', [
  'google_artifact_registry_repository_iam_member.publisher',
  'google_artifact_registry_repository_iam_member.deployer_reader',
  'google_artifact_registry_repository_iam_member.cloud_run_reader["staging"]',
  'google_artifact_registry_repository_iam_member.cloud_run_reader["production"]',
]);
requireRoleAndMember(
  'google_artifact_registry_repository_iam_member.publisher',
  'roles/artifactregistry.writer',
  publisherMember,
);
requireRoleAndMember(
  'google_artifact_registry_repository_iam_member.deployer_reader',
  'roles/artifactregistry.reader',
  deployerMember,
);
for (const environment of environments) {
  const address =
    `google_artifact_registry_repository_iam_member.cloud_run_reader["${environment}"]`;
  const values = requireResource(address);
  if (values?.role !== 'roles/artifactregistry.reader') {
    violations.push(`${address} имеет неожиданную роль ${values?.role}`);
  }
}

assertExactAddresses('google_cloud_run_v2_service_iam_member', [
  'module.production.google_cloud_run_v2_service_iam_member.public[0]',
  'module.production.google_cloud_run_v2_service_iam_member.public_invoker_policy_operator[0]',
  'module.staging.google_cloud_run_v2_service_iam_member.smoke[0]',
]);
requireRoleAndMember(
  'module.production.google_cloud_run_v2_service_iam_member.public[0]',
  'roles/run.invoker',
  'allUsers',
);
requireRoleAndMember(
  'module.staging.google_cloud_run_v2_service_iam_member.smoke[0]',
  'roles/run.invoker',
  smokeMember,
);
const publicPolicyOperatorBinding = requireResource(
  'module.production.google_cloud_run_v2_service_iam_member.public_invoker_policy_operator[0]',
);
if (publicPolicyOperatorBinding?.member !== deployerMember) {
  violations.push('production public-IAM operator binding выдан не release deployer');
}
const allUsersBindings = [...resourcesByAddress.values()].filter(
  (resource) => resource.values.member === 'allUsers',
);
if (
  allUsersBindings.length !== 1 ||
  allUsersBindings[0]?.address !==
    'module.production.google_cloud_run_v2_service_iam_member.public[0]'
) {
  violations.push('allUsers должен иметь ровно один roles/run.invoker binding на production service');
}

assertExactAddresses('google_project_iam_custom_role', [
  'module.production.google_project_iam_custom_role.public_invoker_policy_operator[0]',
]);
const publicPolicyOperatorRole = requireResource(
  'module.production.google_project_iam_custom_role.public_invoker_policy_operator[0]',
);
if (publicPolicyOperatorRole) {
  assertExactStrings(
    publicPolicyOperatorRole.permissions ?? [],
    ['run.services.getIamPolicy', 'run.services.setIamPolicy'],
    'production public-IAM custom role permissions',
  );
  if (publicPolicyOperatorRole.stage !== 'GA') {
    violations.push('production public-IAM custom role должен быть GA');
  }
}

const forbiddenIamRoles = new Set([
  'roles/owner',
  'roles/editor',
  'roles/run.admin',
  'roles/iam.serviceAccountTokenCreator',
]);
for (const resource of [...resourcesByAddress.values()]) {
  if (forbiddenIamRoles.has(resource.values.role)) {
    violations.push(`${resource.address} использует запрещённую широкую роль ${resource.values.role}`);
  }
}

const repository = requireResource('google_artifact_registry_repository.release');
if (repository) {
  if (repository.deletion_policy !== 'PREVENT') {
    violations.push('Artifact Registry repository не защищён deletion_policy=PREVENT');
  }
  if (repository.docker_config?.[0]?.immutable_tags !== true) {
    violations.push('Artifact Registry repository не запрещает перезапись image tags');
  }
}

function verifyWorkloadIdentity(providerSuffix, expectedWorkflow) {
  const poolAddress = `google_iam_workload_identity_pool.${providerSuffix}`;
  const providerAddress = `google_iam_workload_identity_pool_provider.${providerSuffix}`;
  const workloadIdentityPool = requireResource(poolAddress);
  const workloadIdentityProvider = requireResource(providerAddress);
  if (workloadIdentityPool?.deletion_policy !== 'PREVENT') {
    violations.push(`${poolAddress} не защищён deletion_policy=PREVENT`);
  }
  if (workloadIdentityPool?.disabled !== false) {
    violations.push(`${poolAddress} неожиданно disabled`);
  }
  if (!workloadIdentityProvider) return;
  if (workloadIdentityProvider.deletion_policy !== 'PREVENT') {
    violations.push(`${providerAddress} не защищён deletion_policy=PREVENT`);
  }
  const requiredMappings = {
    'google.subject': 'assertion.sub',
    'attribute.event_name': 'assertion.event_name',
    'attribute.ref': 'assertion.ref',
    'attribute.repository_id': 'assertion.repository_id',
    'attribute.repository_owner_id': 'assertion.repository_owner_id',
    'attribute.workflow_ref': 'assertion.workflow_ref',
  };
  for (const [attribute, assertion] of Object.entries(requiredMappings)) {
    if (workloadIdentityProvider.attribute_mapping?.[attribute] !== assertion) {
      violations.push(`${providerAddress}: mapping ${attribute} -> ${assertion} отсутствует`);
    }
  }

  const repositoryName = plan.variables?.github_repository?.value;
  const repositoryId = plan.variables?.github_repository_id?.value;
  const repositoryOwnerId = plan.variables?.github_repository_owner_id?.value;
  const requiredConditions = [
    `assertion.repository_id == "${repositoryId}"`,
    `assertion.repository_owner_id == "${repositoryOwnerId}"`,
    'assertion.ref == "refs/heads/main"',
    'assertion.event_name == "workflow_dispatch"',
    `assertion.workflow_ref == "${repositoryName}/.github/workflows/${expectedWorkflow}@refs/heads/main"`,
  ];
  for (const condition of requiredConditions) {
    if (!workloadIdentityProvider.attribute_condition?.includes(condition)) {
      violations.push(`${providerAddress}: condition отсутствует: ${condition}`);
    }
  }
  if (workloadIdentityProvider.oidc?.[0]?.issuer_uri !== 'https://token.actions.githubusercontent.com/') {
    violations.push(`${providerAddress} использует неожиданный OIDC issuer`);
  }
}

verifyWorkloadIdentity('github_actions', 'release.yml');
verifyWorkloadIdentity('github_deployment', 'deploy.yml');

const workloadIdentityBinding = requireResource(
  'google_service_account_iam_member.artifact_publisher_workload_identity',
);
if (workloadIdentityBinding?.role !== 'roles/iam.workloadIdentityUser') {
  violations.push('Artifact publisher не имеет ожидаемый roles/iam.workloadIdentityUser binding');
}
const deployerWorkloadIdentityBinding = requireResource(
  'google_service_account_iam_member.release_deployer_workload_identity',
);
if (deployerWorkloadIdentityBinding?.role !== 'roles/iam.workloadIdentityUser') {
  violations.push('Release deployer не имеет ожидаемый roles/iam.workloadIdentityUser binding');
}
const smokeWorkloadIdentityBinding = requireResource(
  'google_service_account_iam_member.smoke_runner_workload_identity',
);
if (smokeWorkloadIdentityBinding?.role !== 'roles/iam.workloadIdentityUser') {
  violations.push('Smoke runner не имеет ожидаемый roles/iam.workloadIdentityUser binding');
}

function rootConfigurationResource(address) {
  return plan.configuration?.root_module?.resources?.find(
    (resource) => resource.address === address,
  );
}

function assertExpressionReferences(resource, expressionName, expectedReferences, label) {
  const references = resource?.expressions?.[expressionName]?.references ?? [];
  for (const reference of expectedReferences) {
    if (!references.includes(reference)) violations.push(`${label}: нет ссылки ${reference}`);
  }
}

const publisherWifConfiguration = rootConfigurationResource(
  'google_service_account_iam_member.artifact_publisher_workload_identity',
);
assertExpressionReferences(
  publisherWifConfiguration,
  'member',
  ['google_iam_workload_identity_pool.github_actions.name'],
  'artifact publisher WIF trust boundary',
);
assertExpressionReferences(
  publisherWifConfiguration,
  'service_account_id',
  ['google_service_account.artifact_publisher.name'],
  'artifact publisher WIF target',
);
const deployerWifConfiguration = rootConfigurationResource(
  'google_service_account_iam_member.release_deployer_workload_identity',
);
assertExpressionReferences(
  deployerWifConfiguration,
  'member',
  ['google_iam_workload_identity_pool.github_deployment.name'],
  'release deployer WIF trust boundary',
);
assertExpressionReferences(
  deployerWifConfiguration,
  'service_account_id',
  ['google_service_account.release_deployer.name'],
  'release deployer WIF target',
);
const smokeWifConfiguration = rootConfigurationResource(
  'google_service_account_iam_member.smoke_runner_workload_identity',
);
assertExpressionReferences(
  smokeWifConfiguration,
  'member',
  ['google_iam_workload_identity_pool.github_deployment.name'],
  'smoke runner WIF trust boundary',
);
assertExpressionReferences(
  smokeWifConfiguration,
  'service_account_id',
  ['google_service_account.smoke_runner.name'],
  'smoke runner WIF target',
);

const productionModule = plan.configuration?.root_module?.module_calls?.production?.module;
const policyOperatorConfiguration = productionModule?.resources?.find(
  (resource) =>
    resource.address === 'google_cloud_run_v2_service_iam_member.public_invoker_policy_operator',
);
assertExpressionReferences(
  policyOperatorConfiguration,
  'role',
  ['google_project_iam_custom_role.public_invoker_policy_operator[0].name'],
  'production public-IAM operator binding',
);

const enabledServices = new Set(
  [...resourcesByAddress.values()]
    .filter((resource) => resource.type === 'google_project_service')
    .map((resource) => resource.values.service),
);
for (const service of ['iamcredentials.googleapis.com', 'sts.googleapis.com']) {
  if (!enabledServices.has(service)) violations.push(`Release project не включает ${service}`);
}

function plainEnvironment(resource) {
  const resourceTemplate = resource.values.template?.[0];
  const container =
    resource.type === 'google_cloud_run_v2_job'
      ? resourceTemplate?.template?.[0]?.containers?.[0]
      : resourceTemplate?.containers?.[0];
  const entries = container?.env ?? [];
  return new Map(
    entries
      .filter((entry) => typeof entry.value === 'string')
      .map((entry) => [entry.name, entry.value]),
  );
}

function containerFor(resource) {
  const resourceTemplate = resource.values.template?.[0];
  return resource.type === 'google_cloud_run_v2_job'
    ? resourceTemplate?.template?.[0]?.containers?.[0]
    : resourceTemplate?.containers?.[0];
}

function secretEnvironmentNames(resource) {
  return (containerFor(resource)?.env ?? [])
    .filter((entry) => Array.isArray(entry.value_source) && entry.value_source.length > 0)
    .map((entry) => entry.name);
}

for (const resource of resourcesByAddress.values()) {
  const deletionPolicyProtectedTypes = new Set([
    'google_project',
    'google_artifact_registry_repository',
    'google_service_account',
    'google_iam_workload_identity_pool',
    'google_iam_workload_identity_pool_provider',
    'google_sql_database_instance',
    'google_sql_database',
    'google_secret_manager_secret',
    'google_cloud_run_v2_service',
    'google_cloud_run_v2_job',
  ]);
  if (
    deletionPolicyProtectedTypes.has(resource.type) &&
    resource.values.deletion_policy !== 'PREVENT'
  ) {
    violations.push(`${resource.address} не защищён deletion_policy=PREVENT`);
  }
  if (
    ['google_sql_database_instance', 'google_secret_manager_secret', 'google_cloud_run_v2_service',
      'google_cloud_run_v2_job'].includes(resource.type) &&
    resource.values.deletion_protection !== true
  ) {
    violations.push(`${resource.address} не фиксирует deletion_protection=true`);
  }
  if (
    resource.type === 'google_sql_database_instance' &&
    resource.values.settings?.[0]?.deletion_protection_enabled !== true
  ) {
    violations.push(`${resource.address} не фиксирует settings.deletion_protection_enabled=true`);
  }
}

for (const resource of resourcesByAddress.values()) {
  if (resource.type === 'google_cloud_run_v2_service') {
    const environment = plainEnvironment(resource);
    if (environment.get('PROXY_TRUST_MODE') !== 'cloud-run') {
      violations.push(`${resource.address} не фиксирует PROXY_TRUST_MODE=cloud-run`);
    }
    if (environment.get('DEMO_MAX_BATCHES') !== '20') {
      violations.push(`${resource.address} не фиксирует DEMO_MAX_BATCHES=20`);
    }
    if (environment.get('DEMO_MAX_SESSIONS') !== '500') {
      violations.push(`${resource.address} не фиксирует DEMO_MAX_SESSIONS=500`);
    }
  }
  if (resource.type === 'google_cloud_run_v2_job') {
    const environment = plainEnvironment(resource);
    if (!['staging', 'production'].includes(environment.get('APP_ENV'))) {
      violations.push(`${resource.address} не фиксирует hosted APP_ENV`);
    }
    if (environment.get('LOG_LEVEL') !== 'info') {
      violations.push(`${resource.address} не фиксирует LOG_LEVEL=info`);
    }
    if (resource.address.endsWith('google_cloud_run_v2_job.database["reset"]')) {
      const container = containerFor(resource);
      assertExactStrings(
        container?.args ?? [],
        ['dist/reset-demo.js'],
        `${resource.address} args`,
      );
      assertExactStrings(
        secretEnvironmentNames(resource),
        ['MIGRATION_DATABASE_URL'],
        `${resource.address} secret environment`,
      );
      const resetServiceAccount = resource.values.template?.[0]?.template?.[0]?.service_account;
      if (!resetServiceAccount?.includes('work-card-reset@')) {
        violations.push(`${resource.address} выполняется не под reset service account`);
      }
    }
  }
}

if (violations.length > 0) {
  process.stderr.write('Terraform review plan отклонён:\n');
  for (const violation of violations) process.stderr.write(`- ${violation}\n`);
  process.exitCode = 1;
} else {
  const plannedResources = [...resourceCounts.values()].reduce((sum, count) => sum + count, 0);
  process.stdout.write(
    `Terraform review plan безопасен: ${plannedResources} ресурсов; IAM, WIF, demo-capacity и deletion guards соответствуют контракту; secret payloads/credential URLs отсутствуют.\n`,
  );
}
