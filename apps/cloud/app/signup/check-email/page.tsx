import Link from 'next/link'

export default function CheckEmailPage() {
  return (
    <main className="mx-auto flex min-h-screen max-w-md flex-col justify-center px-6 py-16 text-center">
      <h1 className="text-3xl font-semibold tracking-tight">Check your email</h1>
      <p className="mt-3 text-neutral-400">
        We sent a confirmation link. Click it to finish creating your project.
      </p>
      <Link
        href="https://docs.mushimushi.dev/quickstart"
        className="mt-8 inline-block rounded-md border border-neutral-700 px-4 py-2 hover:border-neutral-500"
      >
        Skim the quickstart while you wait →
      </Link>
    </main>
  )
}
