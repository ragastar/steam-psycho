import LoginForm from "@/components/admin/LoginForm";

export default function AdminLoginPage() {
  return (
    <div className="flex min-h-screen items-center justify-center bg-zinc-950">
      <div className="w-full max-w-sm space-y-6 p-6">
        <div className="text-center">
          <h1 className="text-2xl font-bold text-white">GamerType Admin</h1>
          <p className="mt-2 text-sm text-zinc-400">Введите пароль для доступа</p>
        </div>
        <LoginForm />
      </div>
    </div>
  );
}
