import type { ButtonHTMLAttributes, PropsWithChildren } from 'react'
import './Button.css'

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: 'primary' | 'secondary' | 'danger'
}

export function Button({
  variant = 'primary',
  className = '',
  children,
  ...props
}: PropsWithChildren<ButtonProps>) {
  return (
    <button className={'ui-button ui-button--' + variant + ' ' + className} {...props}>
      {children}
    </button>
  )
}
