# JWT Authentication Implementation

This document explains the JWT authentication system implemented in your NestJS backend.

## Features

- **JWT Access Tokens**: Short-lived tokens for API access
- **JWT Refresh Tokens**: Long-lived tokens for refreshing access tokens
- **Role-based Access Control**: Protect routes based on user roles
- **Public Routes**: Mark specific routes as public (no authentication required)
- **Token Validation**: Automatic token validation and user extraction

## Environment Variables

Create a `.env` file with the following variables:

```bash
# Server Configuration
PORT=3000

# JWT Configuration
JWT_ACCESS_TOKEN_SECRET=your-super-secret-access-token-key-here
JWT_ACCESS_TOKEN_EXPIRATION_TIME=15m
JWT_REFRESH_TOKEN_SECRET=your-super-secret-refresh-token-key-here
JWT_REFRESH_TOKEN_EXPIRATION_TIME=7d

# Database Configuration
DATABASE_HOST=localhost
DATABASE_PORT=5432
DATABASE_USERNAME=postgres
DATABASE_PASSWORD=password
DATABASE_NAME=your_database_name
```

## API Endpoints

### Authentication Endpoints

#### 1. Sign Up
```http
POST /auth/sign-up
Content-Type: application/json

{
  "email": "user@example.com",
  "password": "password123"
}
```

**Response:**
```json
{
  "user": {
    "id": 1,
    "email": "user@example.com",
    "role": "user"
  },
  "accessToken": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...",
  "refreshToken": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9..."
}
```

#### 2. Sign In
```http
POST /auth/sign-in
Content-Type: application/json

{
  "email": "user@example.com",
  "password": "password123"
}
```

**Response:**
```json
{
  "accessToken": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...",
  "refreshToken": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...",
  "userId": 1,
  "email": "user@example.com",
  "role": "user"
}
```

#### 3. Refresh Token
```http
POST /auth/refresh
Content-Type: application/json

{
  "refreshToken": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9..."
}
```

**Response:**
```json
{
  "accessToken": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...",
  "refreshToken": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...",
  "userId": 1,
  "email": "user@example.com",
  "role": "user"
}
```

#### 4. Get Profile (Protected Route)
```http
GET /auth/profile
Authorization: Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...
```

**Response:**
```json
{
  "id": 1,
  "email": "user@example.com",
  "role": "user"
}
```

## Protecting Routes

### 1. Basic Authentication

Use the `@UseGuards(JwtAuthGuard)` decorator to protect routes:

```typescript
import { Controller, Get, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';

@Controller('protected')
@UseGuards(JwtAuthGuard)
export class ProtectedController {
  @Get()
  getProtectedData() {
    return { message: 'This is protected data' };
  }
}
```

### 2. Public Routes

Use the `@Public()` decorator to mark routes as public:

```typescript
import { Controller, Get } from '@nestjs/common';
import { Public } from '../auth/decorators/public.decorator';

@Controller('public')
export class PublicController {
  @Public()
  @Get()
  getPublicData() {
    return { message: 'This is public data' };
  }
}
```

### 3. Role-based Access Control

Use the `@Roles()` decorator and `RolesGuard` for role-based access:

```typescript
import { Controller, Get, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard, Roles } from '../auth/guards/roles.guard';
import { UserRole } from '../user/entities/user.entity';

@Controller('admin')
@UseGuards(JwtAuthGuard, RolesGuard)
export class AdminController {
  @Get()
  @Roles(UserRole.ADMIN)
  getAdminData() {
    return { message: 'Admin only data' };
  }

  @Get('moderator')
  @Roles(UserRole.ADMIN, UserRole.USER)
  getModeratorData() {
    return { message: 'Admin and User data' };
  }
}
```

## Accessing User Information

Use the `@CurrentUser()` decorator to access the authenticated user:

```typescript
import { Controller, Get, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { CurrentUser } from '../auth/decorators/current-user.decorator';

@Controller('user')
@UseGuards(JwtAuthGuard)
export class UserController {
  @Get('me')
  getCurrentUser(@CurrentUser() user: any) {
    return user;
  }
}
```

## Token Structure

### Access Token Payload
```json
{
  "sub": 1,
  "email": "user@example.com",
  "role": "user",
  "type": "access",
  "iat": 1640995200,
  "exp": 1640996100
}
```

### Refresh Token Payload
```json
{
  "sub": 1,
  "email": "user@example.com",
  "role": "user",
  "type": "refresh",
  "iat": 1640995200,
  "exp": 1641667200
}
```

## Security Features

1. **Token Type Validation**: Access and refresh tokens are differentiated by type
2. **Automatic Expiration**: Tokens automatically expire based on configuration
3. **Role-based Access**: Routes can be protected based on user roles
4. **Public Route Support**: Specific routes can be marked as public
5. **Secure Token Storage**: Refresh tokens are stored securely and validated

## Usage Examples

### Frontend Integration

```typescript
// Store tokens after login
const response = await fetch('/auth/sign-in', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ email, password })
});

const { accessToken, refreshToken } = await response.json();

// Store tokens
localStorage.setItem('accessToken', accessToken);
localStorage.setItem('refreshToken', refreshToken);

// Use access token for API calls
const apiResponse = await fetch('/protected/data', {
  headers: {
    'Authorization': `Bearer ${accessToken}`
  }
});

// Refresh token when access token expires
const refreshResponse = await fetch('/auth/refresh', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ refreshToken })
});

const { accessToken: newAccessToken } = await refreshResponse.json();
localStorage.setItem('accessToken', newAccessToken);
```

### Error Handling

The system provides clear error messages:

- `Invalid credentials` - Wrong email/password
- `User already exists` - Email already registered
- `Invalid token` - Malformed or expired access token
- `Invalid refresh token` - Malformed or expired refresh token
- `User not found` - User doesn't exist
- `Invalid token type` - Wrong token type used

## Best Practices

1. **Store tokens securely**: Use httpOnly cookies or secure storage
2. **Handle token expiration**: Implement automatic token refresh
3. **Validate tokens**: Always validate tokens on the server side
4. **Use HTTPS**: Always use HTTPS in production
5. **Rotate secrets**: Regularly rotate JWT secrets
6. **Monitor usage**: Log and monitor authentication attempts

## Testing

To test the JWT implementation:

1. Start the application: `pnpm run start:dev`
2. Create a user: `POST /auth/sign-up`
3. Sign in: `POST /auth/sign-in`
4. Use the access token: `GET /auth/profile`
5. Test role-based access: `GET /admin` (requires admin role)
6. Test public routes: `GET /public` (no token required)

