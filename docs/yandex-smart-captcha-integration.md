# Yandex SmartCaptcha Integration

This document describes the integration of Yandex SmartCaptcha with Logto for bot protection.

## Overview

Yandex SmartCaptcha is an intelligent CAPTCHA solution that provides user-friendly bot protection with minimal user interaction required. It's designed to protect websites from automated attacks while maintaining a smooth user experience.

## Features

- **User-friendly**: Minimal interaction required from users
- **Intelligent**: Uses advanced algorithms to detect bots
- **Customizable**: Supports light and dark themes
- **Secure**: Provides robust protection against automated attacks

## Setup

### 1. Create a Yandex Cloud Account

1. Go to [Yandex Cloud Console](https://console.cloud.yandex.com/)
2. Create an account or sign in to your existing account
3. Create a new cloud or use an existing one

### 2. Create a SmartCaptcha

1. Navigate to **SmartCaptcha** in the Yandex Cloud Console
2. Click **Create captcha**
3. Fill in the following details:
   - **Name**: Choose a descriptive name for your captcha
   - **Domain**: Add your Logto endpoint domain (e.g., `https://your-tenant.logto.app`)
   - **Type**: Choose the captcha type that suits your needs

### 3. Get Configuration Keys

1. After creating the captcha, navigate to its settings
2. Copy the **Site key** and **Secret key**
3. These keys will be used to configure Logto

### 4. Configure Logto

1. Go to your Logto Admin Console
2. Navigate to **Security** > **CAPTCHA**
3. Click **Add CAPTCHA**
4. Select **Yandex SmartCaptcha** from the provider list
5. Enter the **Site key** and **Secret key** from step 3
6. Save the configuration

### 5. Enable CAPTCHA

1. In the CAPTCHA settings, toggle on **Enable CAPTCHA**
2. This will activate CAPTCHA verification for sign-up, sign-in, and password recovery flows

## Technical Details

### API Endpoint

Yandex SmartCaptcha uses the following validation endpoint:
```
POST https://smartcaptcha.yandexcloud.net/validate
```

### Request Format

The validation request includes:
- `secret`: Your secret key
- `token`: The captcha token from the client
- `ip`: (Optional) Client IP address

### Response Format

The validation response includes:
- `status`: "ok" for successful validation, error code otherwise
- `message`: Optional error message

### Frontend Integration

The Yandex SmartCaptcha script is loaded from:
```
https://smartcaptcha.yandexcloud.net/captcha.js
```

The widget is rendered using the `smartCaptcha.render()` method with the following options:
- `sitekey`: Your site key
- `theme`: "light" or "dark" based on Logto's theme
- `callback`: Function called when captcha is completed
- `error-callback`: Function called when an error occurs
- `size`: Widget size (set to "flexible")

## Troubleshooting

### Common Issues

1. **Invalid site key**: Ensure the site key is correct and matches your Yandex Cloud configuration
2. **Domain mismatch**: Verify that your Logto domain is added to the allowed domains in Yandex Cloud
3. **Script loading issues**: Check that the Yandex SmartCaptcha script is loading correctly in the browser

### Debug Mode

To debug captcha issues:
1. Check the browser console for any JavaScript errors
2. Verify that the captcha widget is rendering correctly
3. Check the network tab for any failed requests to the Yandex API

## Security Considerations

- Keep your secret key secure and never expose it in client-side code
- Regularly rotate your keys for enhanced security
- Monitor captcha success rates to detect potential issues
- Consider implementing additional security measures for high-risk applications

## Support

For issues related to Yandex SmartCaptcha:
- Check the [Yandex Cloud documentation](https://cloud.yandex.com/en/docs/smartcaptcha/)
- Contact Yandex Cloud support for technical issues
- Refer to Logto documentation for integration-specific questions 