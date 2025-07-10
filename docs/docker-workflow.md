# Docker Build and Publish Workflow

This repository includes a GitHub Actions workflow that can build and publish Docker images to GitHub Container Registry (ghcr.io).

## 🆓 GitHub Container Registry - Free Tier

Yes, GitHub Container Registry is **free** for:
- ✅ Public repositories (unlimited usage)
- ✅ Private repositories (with generous free tier limits)

## 🚀 How to Use

### 1. Manual Trigger
The workflow is configured to run **manually only** for security and control.

To trigger the workflow:
1. Go to your repository on GitHub
2. Click on **Actions** tab
3. Select **"Build and Publish Docker Image"** workflow
4. Click **"Run workflow"** button
5. Optionally specify a custom tag (default is `latest`)
6. Click **"Run workflow"** to start the build

### 2. Workflow Inputs
- **tag**: Docker image tag (e.g., `latest`, `v1.0.0`, `develop`)
  - Default: `latest`
  - Optional: You can specify any custom tag

### 3. Generated Tags
The workflow automatically generates multiple tags:
- Your specified tag (or `latest`)
- Branch name (e.g., `main`, `develop`)
- Git SHA with branch prefix (e.g., `main-abc1234`)

## 📦 Published Images

After successful build, your Docker image will be available at:
```
ghcr.io/YOUR_USERNAME/logto:TAG
```

For example:
```bash
# Pull the latest image
docker pull ghcr.io/YOUR_USERNAME/logto:latest

# Run the container
docker run -p 3001:3001 ghcr.io/YOUR_USERNAME/logto:latest
```

## 🔑 Permissions

The workflow uses the built-in `GITHUB_TOKEN` with the following permissions:
- `contents: read` - Read repository contents
- `packages: write` - Publish to GitHub Packages
- `attestations: write` - Generate build provenance
- `id-token: write` - OIDC token for attestations

## 🔍 Features

- ✅ **Manual trigger only** - No automatic builds for security
- ✅ **Multi-stage Docker build** - Uses your existing Dockerfile
- ✅ **Multiple tags** - Automatically generates useful tags
- ✅ **Build provenance** - Generates attestations for security
- ✅ **Free hosting** - Uses GitHub Container Registry
- ✅ **Secure** - Uses GitHub's built-in authentication

## 🛠️ Customization

You can customize the workflow by editing `.github/workflows/build-docker.yml`:

- Change the default tag
- Add more tag patterns
- Modify build context
- Add build arguments
- Configure caching strategies

## 📝 Example Usage

```bash
# Pull and run the published image
docker pull ghcr.io/YOUR_USERNAME/logto:latest
docker run -d \
  -p 3001:3001 \
  -e DB_URL=postgresql://user:pass@localhost:5432/logto \
  ghcr.io/YOUR_USERNAME/logto:latest
```

## 🔗 Registry URL

Your published packages will be visible at:
```
https://github.com/YOUR_USERNAME/REPOSITORY_NAME/pkgs/container/REPOSITORY_NAME
``` 