const tenants = {
  title: 'Settings',
  description: 'Efficiently manage tenant settings and customize your domain.',
  tabs: {
    settings: 'Settings',
    members: 'Members',
    domains: 'Domains',
    subscription: 'Plan and billing',
    billing_history: 'Billing history',
  },
  management: {
    title: 'Tenant Management',
    description: 'Manage all your tenants in one place. Create, edit, and delete tenants.',
  },
  settings: {
    title: 'SETTINGS',
    description: 'Set the tenant name and view your data hosted region and tenant type.',
    tenant_id: 'Tenant ID',
    tenant_name: 'Tenant name',
    tenant_name_placeholder: 'My tenant',
    tenant_region: 'Data region',
    tenant_region_description:
      'The physical location where your user and application data is stored. This cannot be changed after creation.',
    tenant_type: 'Tenant type',
    development_description:
      'For testing only and should not be used in production. No subscription is required. It has all the pro features but has limitations like the sign-in banner. <a>Learn more</a>',
    production_description:
      'For apps that are used by end-users and may require a paid subscription. <a>Learn more</a>',
    tenant_info_saved: 'Tenant information saved successfully.',
    environment_tag_development: 'Dev',
    environment_tag_production: 'Prod',
  },
  actions: {
    edit: 'Edit',
    delete: 'Delete',
    settings: 'Settings',
    domains: 'Domains',
  },
  env_tag: {
    development: 'Development',
    production: 'Production',
  },
  full_env_tag: {
    development: 'Dev',
    production: 'Prod',
  },
  deletion: {
    delete_modal: {
      title: 'Delete tenant',
      description_line1:
        'Are you sure you want to delete your tenant "<span>{{name}}</span>" with environment suffix tag "<span>{{tag}}</span>"? This action cannot be undone and will result in the permanent deletion of all your data and account information.',
      description_line2:
        'Before deleting the account, maybe we can help you. <span><a>Contact us via Email</a></span>',
      description_line3:
        'If you want to proceed, please enter the tenant name "<span>{{name}}</span>" to confirm.',
      delete_button: 'Permanently delete',
      cannot_delete_title: 'Cannot delete tenant',
      cannot_delete_description:
        "Sorry, you can't delete this tenant right now. Please make sure you're on the Free plan and have paid all outstanding invoices.",
      cannot_delete_system: 'Default and system tenants cannot be deleted.',
      delete_failed: 'Failed to delete tenant.',
    },
    input_placeholder: 'Enter tenant name',
    error_message: 'Please enter the correct tenant name',
  },
  deletion_card: {
    title: 'Delete tenant',
    tenant_deletion: 'Delete tenant',
    tenant_deletion_description:
      'Deleting a tenant will permanently remove all associated user data and configuration. Please proceed with caution.',
    tenant_deletion_button: 'Delete tenant',
  },
  leave_tenant_card: {
    title: 'LEAVE',
    leave_tenant: 'Leave tenant',
    leave_tenant_description:
      'Any resources in the tenant will remain but you no longer have access to this tenant.',
    last_admin_note: 'To leave this tenant, ensure at least one more member has the Admin role.',
  },
  create_modal: {
    title: 'Create tenant',
    subtitle: 'Create a new tenant that has isolated resources and users.',
    tenant_usage_purpose: 'What do you want to use this tenant for?',
    development_description:
      "For testing only and shouldn't be used in production. No subscription is required.",
    development_hint: 'It has all the pro features but has limitations like a sign-in banner.',
    production_description: 'For use by end-users and may require a paid subscription.',
    available_plan: 'Available plan:',
    create_button: 'Create tenant',
    tenant_name_placeholder: 'My tenant',
    tenant_created: 'Tenant created successfully.',
    invitation_failed:
      'Some invitation failed to send. Please try again in Settings -> Members later.',
    tenant_type_description: 'This cannot be changed after creation.',
  },
  edit_modal: {
    title: 'Edit tenant',
    subtitle: 'Update tenant information and settings.',
  },
  dev_tenant_migration: {
    title: 'You can now try our Pro features for free by creating a new "Development tenant"!',
    affect_title: 'How does this affect you?',
    hint_1:
      'We are replacing the old <strong>environment tags</strong> with two new tenant types: <strong>"Development"</strong> and <strong>"Production"</strong>.',
    hint_2:
      'To ensure a seamless transition and uninterrupted functionality, all early-created tenants will be elevated to the <strong>Production</strong> tenant type along with your previous subscription.',
    hint_3: "Don't worry, all your other settings will remain the same.",
    about_tenant_type: 'About tenant type',
  },
  leave_tenant_modal: {
    description: 'Are you sure you want to leave this tenant?',
    leave_button: 'Leave',
  },
  tenant_landing_page: {
    title: "You haven't created a tenant yet",
    description:
      'To start configuring your project with Logto, please create a new tenant. If you need to log out or delete your account, just click on the avatar button in the top right corner.',
    create_tenant_button: 'Create tenant',
  },
  status: {
    mau_exceeded: 'MAU exceeded',
    token_exceeded: 'Token exceeded',
    suspended: 'Suspended',
    overdue: 'Overdue',
  },
  tenant_suspended_page: {
    title: 'Tenant suspended. Contact us to restore access.',
    description_1:
      'We deeply regret to inform you that your tenant account has been temporarily suspended due to improper use, including exceeding MAU limits, overdue payments, or other unauthorized actions.',
    description_2:
      'If you require further clarification, have any concerns, or wish to restore full functionality and unblock your tenants, please do not hesitate to contact us immediately.',
  },
  production_tenant_notification: {
    text: "You're in a dev tenant for free testing. Create a production tenant to go live.",
    action: 'Create tenant',
  },
  tenant: 'Tenant',
};

export default Object.freeze(tenants);
