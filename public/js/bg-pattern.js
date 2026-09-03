/* ZoraBot subtle pattern background — lightweight canvas */
(function () {
  'use strict'
  if (window.__zoraBgInit) return
  window.__zoraBgInit = true

  function start() {
    if (window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
      return
    }

    var wrap = document.querySelector('.app-background')
    if (!wrap) {
      wrap = document.createElement('div')
      wrap.className = 'app-background'
      wrap.setAttribute('aria-hidden', 'true')
      wrap.innerHTML = '<canvas id="zora-pattern"></canvas>'
      document.body.prepend(wrap)
    }

    var canvas = document.getElementById('zora-pattern')
    if (!canvas) return
    var ctx = canvas.getContext('2d', { alpha: true })
    if (!ctx) return

    var width = 0, height = 0, dpr = 1
    var patterns = [], particles = []
    var lastTime = 0, animationFrame = 0

    function getPatternCount() {
      if (width < 600) return 14
      if (width < 1000) return 22
      return 32
    }
    function getParticleCount() {
      if (width < 600) return 12
      if (width < 1000) return 20
      return 28
    }
    function random(min, max) {
      return Math.random() * (max - min) + min
    }

    function resize() {
      width = window.innerWidth
      height = window.innerHeight
      dpr = Math.min(window.devicePixelRatio || 1, 1.5)
      canvas.width = width * dpr
      canvas.height = height * dpr
      canvas.style.width = width + 'px'
      canvas.style.height = height + 'px'
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
      createPatterns()
      createParticles()
    }

    function createPatterns() {
      patterns = []
      var count = getPatternCount()
      for (var i = 0; i < count; i++) {
        patterns.push({
          x: random(-50, width + 50),
          y: random(-50, height + 50),
          size: random(14, 48),
          rotation: random(0, Math.PI * 2),
          rotationSpeed: random(-0.00025, 0.00025),
          floatSpeed: random(0.0005, 0.0015),
          floatOffset: random(0, Math.PI * 2),
          opacity: random(0.03, 0.11),
          type: Math.floor(Math.random() * 8)
        })
      }
    }

    function createParticles() {
      particles = []
      var count = getParticleCount()
      for (var i = 0; i < count; i++) {
        particles.push({
          x: random(0, width),
          y: random(0, height),
          vx: random(-0.025, 0.025),
          vy: random(-0.025, 0.025),
          radius: random(0.7, 1.6),
          opacity: random(0.06, 0.2)
        })
      }
    }

    function line(x1, y1, x2, y2, opacity) {
      ctx.beginPath()
      ctx.moveTo(x1, y1)
      ctx.lineTo(x2, y2)
      ctx.strokeStyle = 'rgba(15,23,42,' + opacity + ')'
      ctx.lineWidth = 1
      ctx.stroke()
    }

    function dot(x, y, radius, opacity) {
      ctx.beginPath()
      ctx.arc(x, y, radius, 0, Math.PI * 2)
      ctx.fillStyle = 'rgba(15,23,42,' + opacity + ')'
      ctx.fill()
    }

    function drawCircle(x, y, size, opacity) {
      ctx.beginPath()
      ctx.arc(x, y, size, 0, Math.PI * 2)
      ctx.strokeStyle = 'rgba(15,23,42,' + opacity + ')'
      ctx.lineWidth = 1
      ctx.stroke()
    }

    function drawSquare(x, y, size, rotation, opacity) {
      ctx.save()
      ctx.translate(x, y)
      ctx.rotate(rotation)
      ctx.strokeStyle = 'rgba(15,23,42,' + opacity + ')'
      ctx.lineWidth = 1
      ctx.strokeRect(-size / 2, -size / 2, size, size)
      ctx.restore()
    }

    function drawDiamond(x, y, size, rotation, opacity) {
      ctx.save()
      ctx.translate(x, y)
      ctx.rotate(rotation)
      ctx.beginPath()
      ctx.moveTo(0, -size)
      ctx.lineTo(size, 0)
      ctx.lineTo(0, size)
      ctx.lineTo(-size, 0)
      ctx.closePath()
      ctx.strokeStyle = 'rgba(15,23,42,' + opacity + ')'
      ctx.lineWidth = 1
      ctx.stroke()
      ctx.restore()
    }

    function drawCross(x, y, size, opacity) {
      line(x - size, y, x + size, y, opacity)
      line(x, y - size, x, y + size, opacity)
      dot(x, y, 1.4, opacity + 0.06)
    }

    function drawHexagon(x, y, size, rotation, opacity) {
      ctx.save()
      ctx.translate(x, y)
      ctx.rotate(rotation)
      ctx.beginPath()
      for (var i = 0; i < 6; i++) {
        var angle = Math.PI / 3 * i
        var px = Math.cos(angle) * size
        var py = Math.sin(angle) * size
        if (i === 0) ctx.moveTo(px, py)
        else ctx.lineTo(px, py)
      }
      ctx.closePath()
      ctx.strokeStyle = 'rgba(15,23,42,' + opacity + ')'
      ctx.lineWidth = 1
      ctx.stroke()
      ctx.restore()
    }

    function drawAtom(x, y, size, rotation, opacity) {
      var orbit1 = size
      var orbit2 = size * 0.65
      ctx.save()
      ctx.translate(x, y)
      ctx.rotate(rotation)
      ctx.beginPath()
      ctx.ellipse(0, 0, orbit1, orbit1 * 0.35, 0, 0, Math.PI * 2)
      ctx.strokeStyle = 'rgba(15,23,42,' + opacity + ')'
      ctx.lineWidth = 1
      ctx.stroke()
      ctx.rotate(1.0)
      ctx.beginPath()
      ctx.ellipse(0, 0, orbit2, orbit2 * 0.35, 0, 0, Math.PI * 2)
      ctx.strokeStyle = 'rgba(15,23,42,' + (opacity * 0.75) + ')'
      ctx.stroke()
      dot(Math.cos(rotation * 5) * orbit1, Math.sin(rotation * 5) * orbit1 * 0.35, 1.5, opacity + 0.1)
      dot(0, 0, 1.8, opacity + 0.1)
      ctx.restore()
    }

    function drawTechnical(x, y, size, opacity) {
      var length = size * 1.5
      line(x - length, y, x, y, opacity)
      line(x, y, x, y + length, opacity)
      line(x, y + length, x + size, y + length, opacity)
      dot(x + size, y + length, 1.8, opacity + 0.08)
    }

    function drawMiniGrid(x, y, size, opacity) {
      var gap = 7
      for (var i = 0; i < 4; i++) {
        line(x, y + i * gap, x + size, y + i * gap, opacity)
      }
      for (var j = 0; j < 4; j++) {
        dot(x + j * gap, y, 1, opacity + 0.02)
      }
    }

    function drawPattern(obj, now) {
      obj.rotation += obj.rotationSpeed
      var floatX = Math.sin(now * obj.floatSpeed + obj.floatOffset) * 3.5
      var floatY = Math.cos(now * obj.floatSpeed * 0.8 + obj.floatOffset) * 3.5
      var x = obj.x + floatX
      var y = obj.y + floatY
      switch (obj.type) {
        case 0: drawAtom(x, y, obj.size, obj.rotation, obj.opacity); break
        case 1:
          drawCircle(x, y, obj.size, obj.opacity)
          drawCircle(x, y, obj.size * 0.45, obj.opacity * 0.55)
          dot(x, y, 1.4, obj.opacity + 0.06)
          break
        case 2: drawDiamond(x, y, obj.size * 0.6, obj.rotation, obj.opacity); break
        case 3:
          drawSquare(x, y, obj.size, obj.rotation, obj.opacity)
          drawSquare(x, y, obj.size * 0.45, -obj.rotation, obj.opacity * 0.5)
          break
        case 4: drawCross(x, y, obj.size * 0.45, obj.opacity); break
        case 5: drawHexagon(x, y, obj.size * 0.55, obj.rotation, obj.opacity); break
        case 6: drawTechnical(x, y, obj.size * 0.5, obj.opacity); break
        case 7: drawMiniGrid(x, y, obj.size, obj.opacity); break
      }
    }

    function drawConnections() {
      for (var i = 0; i < patterns.length; i++) {
        for (var j = i + 1; j < patterns.length; j++) {
          var a = patterns[i], b = patterns[j]
          var dx = a.x - b.x, dy = a.y - b.y
          var distance = Math.sqrt(dx * dx + dy * dy)
          if (distance < 150) {
            line(a.x, a.y, b.x, b.y, (1 - distance / 150) * 0.03)
          }
        }
      }
    }

    function drawParticles() {
      for (var i = 0; i < particles.length; i++) {
        var p = particles[i]
        p.x += p.vx
        p.y += p.vy
        if (p.x < -5) p.x = width + 5
        if (p.x > width + 5) p.x = -5
        if (p.y < -5) p.y = height + 5
        if (p.y > height + 5) p.y = -5
        dot(p.x, p.y, p.radius, p.opacity)
      }
    }

    function animate(timestamp) {
      if (timestamp - lastTime < 32) {
        animationFrame = requestAnimationFrame(animate)
        return
      }
      lastTime = timestamp
      ctx.clearRect(0, 0, width, height)

      var gridSize = 48
      ctx.beginPath()
      ctx.strokeStyle = 'rgba(15,23,42,0.016)'
      ctx.lineWidth = 1
      for (var x = 0; x < width; x += gridSize) {
        ctx.moveTo(x, 0)
        ctx.lineTo(x, height)
      }
      for (var y = 0; y < height; y += gridSize) {
        ctx.moveTo(0, y)
        ctx.lineTo(width, y)
      }
      ctx.stroke()

      drawConnections()
      for (var i = 0; i < patterns.length; i++) drawPattern(patterns[i], timestamp)
      drawParticles()
      animationFrame = requestAnimationFrame(animate)
    }

    window.addEventListener('resize', resize)
    resize()
    animationFrame = requestAnimationFrame(animate)
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', start)
  } else {
    start()
  }
})()
